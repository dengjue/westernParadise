#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""单文件 HTML 结构分析器。

用途：
    对「把一个完整工程内联进单个 HTML」这类交付物做静态拆解，回答三个问题：
      1. 是不是完全本地渲染？
      2. 有没有加载远程资源？
      3. 是怎么做出来的（原始工程结构 / 生成指纹 / 打包方式）？

设计约定：
    - 纯静态分析，不执行 HTML 里的任何 JavaScript，不发起任何网络请求。
    - 所有路径通过命令行参数传入，不硬编码绝对路径。
    - 输出为 JSON + Markdown + 纯文本，便于人读和后续脚本消费。
    - 「零远程」结论只能由证据推导，脚本不会替用户下主观定论；
      会把所有可疑字符串原样列出，由使用者复核。

用法：
    python3 scan_single_html.py
    python3 scan_single_html.py --input /abs/path/to/game.html --output-dir /abs/path/to/data
    python3 scan_single_html.py --extract-css --extract-js

依赖：仅 Python 3.9+ 标准库。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# 扫描规则集中放在这里，方便按项目增删，不散落在逻辑里
# ---------------------------------------------------------------------------

# 可能真实发起网络请求的 API。注意：出现关键字 ≠ 实际调用，
# 例如 Three.js 的 FileLoader 类定义里就有 fetch()，但游戏未必实例化它。
NETWORK_APIS: tuple[str, ...] = (
    "fetch(",
    "XMLHttpRequest",
    "new WebSocket",
    "EventSource",
    "sendBeacon",
    "importScripts",
    "navigator.serviceWorker",
    "new URL(",
    "window.open",
    "location.href",
    "location.assign",
    "location.replace",
)

# 外链标签 / CSS 引用 / 字体等，用于判断是否自包含
EXTERNAL_MARKERS: tuple[str, ...] = (
    "<link",
    "<iframe",
    "<img",
    "<audio",
    "<video",
    "<source",
    "<object",
    "<embed",
    "<base",
    "@import",
    "@font-face",
    "url(",
    "src=",
    "href=",
)

# 表面看起来像 URL，但需要人工区分「常量」与「真实请求」的模式
SUSPICIOUS_LITERAL_RE = re.compile(
    r"(https?:|://|\.png|\.jpg|\.jpeg|\.webp|\.glb|\.gltf|\.mp3|\.wav|\.ogg|"
    r"\.woff2?|\.ttf|\.wasm|/api/|www\.)",
    re.IGNORECASE,
)

# 形如 01-shared.js / 47-frost-shell2-steel.js 的原始工程文件名
MODULE_FILENAME_RE = re.compile(r"[\w./-]+\.(?:js|css|glsl|frag|vert)\b")

# 带数字的模块前缀（02-render.js → render），用于按模块聚类
MODULE_PREFIX_RE = re.compile(r"^\d{2,3}-([\w-]+?)(?:\d+)?\.js$")


@dataclass
class ScanResult:
    """一次扫描的全部结果，字段与输出的 JSON 一一对应。"""

    meta: dict[str, Any] = field(default_factory=dict)
    structure: dict[str, Any] = field(default_factory=dict)
    remote_check: dict[str, Any] = field(default_factory=dict)
    fingerprints: dict[str, Any] = field(default_factory=dict)
    modules: dict[str, Any] = field(default_factory=dict)
    design_system: dict[str, Any] = field(default_factory=dict)
    gameplay: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "meta": self.meta,
            "structure": self.structure,
            "remote_check": self.remote_check,
            "fingerprints": self.fingerprints,
            "modules": self.modules,
            "design_system": self.design_system,
            "gameplay": self.gameplay,
        }


def read_source(path: Path) -> str:
    """读取 HTML 源码。使用 errors='replace' 保证个别乱码不中断整次分析。"""
    raw = path.read_bytes()
    return raw.decode("utf-8", errors="replace")


def extract_blocks(source: str, tag: str) -> list[str]:
    """提取所有 <style> / <script> 标签内的内联内容（不含标签本身）。"""
    pattern = re.compile(rf"<{tag}[^>]*>(.*?)</{tag}>", re.IGNORECASE | re.DOTALL)
    return pattern.findall(source)


def count_occurrences(source: str, needles: Iterable[str]) -> dict[str, int]:
    """统计一组字面量在源码中出现的次数（区分大小写，按字面量精确匹配）。"""
    return {n: source.count(n) for n in needles}


def scan(source: str, source_path: Path) -> ScanResult:
    """执行全部静态扫描，返回结构化结果。此函数不写文件，便于复用与测试。"""
    r = ScanResult()
    styles = extract_blocks(source, "style")
    scripts = extract_blocks(source, "script")
    css = "\n".join(styles)
    js = "\n".join(scripts)

    # ---- 1. 元信息 ----
    r.meta = {
        "source_path": str(source_path),
        "bytes": source_path.stat().st_size,
        "characters": len(source),
        "lines": source.count("\n") + 1,
        "md5": hashlib.md5(source_path.read_bytes()).hexdigest(),
        "title": (re.findall(r"<title>(.*?)</title>", source, re.DOTALL) or [""])[0].strip(),
        "meta_tags": [m.group(0) for m in re.finditer(r"<meta[^>]*>", source, re.IGNORECASE)],
        "longest_line_chars": max((len(x) for x in source.split("\n")), default=0),
    }

    # ---- 2. 结构：标签分布与体积构成 ----
    tag_names = (
        "script", "style", "link", "img", "audio", "video", "iframe", "canvas",
        "svg", "source", "object", "embed", "base", "form", "input",
    )
    tags = re.findall(r"<(" + "|".join(tag_names) + r")\b", source, re.IGNORECASE)
    r.structure = {
        "tag_counts": dict(Counter(t.lower() for t in tags)),
        "style_blocks": len(styles),
        "script_blocks": len(scripts),
        "style_chars": sum(len(x) for x in styles),
        "script_chars": sum(len(x) for x in scripts),
        "html_skeleton_chars": len(source) - sum(len(x) for x in styles) - sum(len(x) for x in scripts),
        "script_opening_tags": [m.group(0) for m in re.finditer(r"<script[^>]*>", source, re.IGNORECASE)],
        "external_script_src": re.findall(r"<script[^>]*\bsrc\s*=\s*[\"']?([^\"'\s>]+)", source, re.IGNORECASE),
        "external_link_href": re.findall(r"<link[^>]*\bhref\s*=\s*[\"']?([^\"'\s>]+)", source, re.IGNORECASE),
    }

    # ---- 3. 远程资源检查：宁可多列可疑项，也不漏报 ----
    urls = re.findall(r"https?://[^\s\"'<>()\[\]{}`]+", source)
    protocol_relative = re.findall(
        r"(?<![\w:/])//[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s\"'<>]*", source
    )
    # 字符串字面量里像 URL 的条目（含正则源码里的 http，需人工区分）
    literals = re.findall(r"[\"']([^\"'\n]{4,200})[\"']", source)
    suspicious: list[str] = []
    seen: set[str] = set()
    for lit in literals:
        if SUSPICIOUS_LITERAL_RE.search(lit) and lit not in seen:
            seen.add(lit)
            suspicious.append(lit)

    css_urls = re.findall(r"url\([^)]*\)", css, re.IGNORECASE)
    r.remote_check = {
        "http_urls": dict(Counter(urls)),
        "protocol_relative_candidates": protocol_relative[:30],
        "suspicious_string_literals": suspicious[:80],
        "css_url_calls": css_urls[:30],
        "css_import": re.findall(r"@import[^;]+;", css, re.IGNORECASE),
        "css_font_face_count": len(re.findall(r"@font-face", css, re.IGNORECASE)),
        "css_external_urls": re.findall(r"https?://[^\s\"')]+", css),
        "network_api_hits": {k: v for k, v in count_occurrences(source, NETWORK_APIS).items() if v},
        "external_marker_hits": {
            k: len(re.findall(re.escape(k), source, re.IGNORECASE)) for k in EXTERNAL_MARKERS
        },
        "data_uri_count": len(re.findall(r"data:[A-Za-z0-9/+.-]+[,;]", source)),
        "blob_url_usage": len(re.findall(r"URL\.createObjectURL", source)),
        "sourcemap_present": "sourceMappingURL" in source,
        "review_note": (
            "出现 fetch/URL 关键字不等于发起请求：需逐个核对上下文。"
            "http://www.w3.org/1999/xhtml 是 createElementNS 的命名空间常量，不产生请求。"
        ),
    }

    # ---- 4. 生成与打包指纹 ----
    claude_tags = re.findall(r"<meta[^>]*claude:[^>]*>", source, re.IGNORECASE)
    r.fingerprints = {
        "claude_meta_tags": claude_tags,
        "generator_keywords": {
            k: len(re.findall(re.escape(k), source, re.IGNORECASE))
            for k in ("SingleFile", "webpack", "vite", "rollup", "esbuild", "saved from", "generated by")
        },
        "three_js_markers": {
            k: len(re.findall(re.escape(k), source))
            for k in ("THREE.", "WebGLRenderer", "REVISION", "FileLoader", "ImageBitmapLoader")
        },
        "bundle_evidence": {
            "esm_export_getter_table": len(re.findall(r"\w+\s*:\s*\(\)\s*=>\s*\w+", source)),
            "minified_short_identifiers": len(re.findall(r"\b[A-Za-z$]{1,2}\d?\s*=\s*class\b", source)),
            "comment_lines": len(re.findall(r"^\s*//", source, re.MULTILINE)),
            "chinese_comment_lines": len(re.findall(r"^\s*//[^\n]*[\u4e00-\u9fff]", source, re.MULTILINE)),
        },
    }

    # ---- 5. 原始工程结构还原 ----
    filenames = sorted({m for m in MODULE_FILENAME_RE.findall(source) if "/" in m or "-" in m})
    module_groups: dict[str, list[str]] = {}
    for name in filenames:
        base = name.rsplit("/", 1)[-1]
        mm = MODULE_PREFIX_RE.match(base)
        key = mm.group(1) if mm else "other"
        module_groups.setdefault(key, []).append(name)
    r.modules = {
        "filenames": filenames,
        "total": len(filenames),
        "groups": {k: sorted(v) for k, v in sorted(module_groups.items())},
        "file_marker_comments": re.findall(r"//\s*(\d{2,3}-[\w.-]+\.js)", source)[:60],
    }

    # ---- 6. 设计系统（CSS 可直接复用）----
    css_vars = re.findall(r"(--[a-zA-Z0-9-]+)\s*:", css)
    css_classes = re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]{2,})", css)
    css_sections = [" ".join(x.split())[:180] for x in re.findall(r"/\*([^*]{10,300})\*/", css)]
    r.design_system = {
        "css_variables": sorted(set(css_vars)),
        "css_variable_count": len(set(css_vars)),
        "top_css_classes": dict(Counter(css_classes).most_common(40)),
        "css_section_comments": css_sections[:20],
        "viewport_fit": "viewport-fit=cover" in source,
        "reduced_motion": "prefers-reduced-motion" in source,
        "touch_class": "is-touch" in source,
    }

    # ---- 7. 玩法与工程能力线索 ----
    gameplay_keys = (
        "health", "maxHealth", "ammo", "reload", "bullet", "raycast", "enemy",
        "wave", "crosshair", "ads", "recoil", "sprint", "crouch", "objective",
        "extract", "radio", "hound", "frost", "pointerlock", "gamepad", "touch",
    )
    r.gameplay = {
        "keyword_counts": {
            k: len(re.findall(re.escape(k), source, re.IGNORECASE)) for k in gameplay_keys
        },
        "input_system": {
            k: len(re.findall(re.escape(k), source, re.IGNORECASE))
            for k in ("requestPointerLock", "keydown", "keyup", "mousemove", "touchstart", "touchmove", "gamepad")
        },
        "named_functions_count": len(re.findall(r"\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]{3,}\s*\(", source)),
        "chinese_ui_strings_count": len({
            " ".join(x.split()) for x in re.findall(r"[\"'`]([^\"'`]*[\u4e00-\u9fff][^\"'`]*)[\"'`]", source)
        }),
        "local_storage_usage": len(re.findall(r"localStorage", source)),
        "url_param_names": sorted(set(re.findall(r"\bi\.([a-zA-Z][a-zA-Z0-9_]{0,18})", _boot_segment(source)))),
        "quality_tiers": sorted(set(re.findall(r'"(low|medium|high|ultra)"', source))),
        "log_prefixes": sorted(set(re.findall(r"\[([a-z]{3,10})\]", source)))[:40],
    }
    return r


def _boot_segment(source: str) -> str:
    """截取启动函数附近的一段源码，用于抽取 URL 参数名，避免全文误匹配。"""
    i = source.find("new URLSearchParams(location.search)")
    return source[max(0, i - 200): i + 2400] if i >= 0 else ""


def write_reports(result: ScanResult, source: str, output_dir: Path,
                  extract_css: bool, extract_js: bool) -> list[Path]:
    """把扫描结果写成多种格式，返回实际写出的文件列表。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    def dump(name: str, text: str) -> None:
        p = output_dir / name
        p.write_text(text, encoding="utf-8")
        written.append(p)

    # 1) 机器可读的完整报告
    dump("扫描报告.json", json.dumps(result.to_dict(), ensure_ascii=False, indent=2))

    # 2) 人读摘要
    s, r = result.structure, result.remote_check
    lines = [
        "# 单文件 HTML 扫描摘要",
        "",
        f"- 源文件：`{result.meta['source_path']}`",
        f"- 体积：{result.meta['bytes']:,} 字节 / {result.meta['lines']:,} 行",
        f"- MD5：`{result.meta['md5']}`",
        f"- 标题：{result.meta['title']}",
        "",
        "## 结构",
        "",
        "| 项 | 值 |",
        "|---|---|",
        f"| 内联 `<style>` | {s['style_blocks']} 块 / {s['style_chars']:,} 字符 |",
        f"| 内联 `<script>` | {s['script_blocks']} 块 / {s['script_chars']:,} 字符 |",
        f"| HTML 骨架 | {s['html_skeleton_chars']:,} 字符 |",
        f"| 外链 script src | {s['external_script_src'] or '无'} |",
        f"| 外链 link href | {s['external_link_href'] or '无'} |",
        f"| 标签统计 | {s['tag_counts']} |",
        "",
        "## 远程资源检查",
        "",
        "| 项 | 结果 |",
        "|---|---|",
        f"| http(s) URL | {r['http_urls']} |",
        f"| CSS url() | {r['css_url_calls'] or '无'} |",
        f"| CSS @import | {r['css_import'] or '无'} |",
        f"| CSS @font-face | {r['css_font_face_count']} |",
        f"| data: URI | {r['data_uri_count']} |",
        f"| Blob 对象 URL | {r['blob_url_usage']} |",
        f"| source map | {'有' if r['sourcemap_present'] else '无'} |",
        f"| 网络 API 命中 | {r['network_api_hits']} |",
        "",
        "> " + r["review_note"],
        "",
        "## 生成指纹",
        "",
        f"- Claude 标记：{result.fingerprints['claude_meta_tags'] or '无'}",
        f"- Three.js 标记：{result.fingerprints['three_js_markers']}",
        f"- 打包证据：{result.fingerprints['bundle_evidence']}",
        "",
        "## 原始工程",
        "",
        f"- 还原出 {result.modules['total']} 个原始文件名",
        "",
    ]
    for name in result.modules["filenames"]:
        lines.append(f"- `{name}`")
    lines.append("")
    dump("扫描摘要.md", "\n".join(lines))

    # 3) 模块清单（结构化）
    dump("原工程模块清单.json", json.dumps(result.modules, ensure_ascii=False, indent=2))

    # 4) CSS 设计 token 与类名
    d = result.design_system
    css_lines = [
        "# CSS 设计系统（从参考原件提取）",
        "",
        f"共 {d['css_variable_count']} 个 CSS 变量：",
        "",
    ]
    css_lines += [f"- `{v}`" for v in d["css_variables"]]
    css_lines += ["", "## 高频类名（前 40）", "", "| 类名 | 次数 |", "|---|---|"]
    css_lines += [f"| `{k}` | {v} |" for k, v in d["top_css_classes"].items()]
    css_lines += ["", "## CSS 分区注释", ""]
    css_lines += [f"- {c}" for c in d["css_section_comments"]]
    css_lines += ["", "## 适配能力", "",
                  f"- viewport-fit=cover：{d['viewport_fit']}",
                  f"- prefers-reduced-motion：{d['reduced_motion']}",
                  f"- 触控 is-touch：{d['touch_class']}", ""]
    dump("CSS设计token与类名.md", "\n".join(css_lines))

    # 5) 调试参数与画质档位
    g = result.gameplay
    dump("调试参数与画质档位.md", "\n".join([
        "# 调试参数与运行配置（从启动函数还原）",
        "",
        "## URL 参数",
        "",
        "启动函数用 `new URLSearchParams(location.search)` 读取地址栏参数。已识别的参数名：",
        "",
        ", ".join(f"`{x}`" for x in g["url_param_names"]) or "（未识别）",
        "",
        "> 具体含义需结合源码注释确认，脚本只做名称抽取，不臆测语义。",
        "",
        "## 输入系统",
        "",
        "| API | 命中次数 |",
        "|---|---|",
    ] + [f"| `{k}` | {v} |" for k, v in g["input_system"].items()] + [
        "",
        "## 其它",
        "",
        f"- 具名函数数量：{g['named_functions_count']}",
        f"- 中文 UI 字符串（去重）：{g['chinese_ui_strings_count']}",
        f"- localStorage 使用：{g['local_storage_usage']} 处",
        f"- 日志前缀：{', '.join(g['log_prefixes'][:30])}",
        "",
    ]))

    # 6) 中文文案全量（去重、保序）
    cn: list[str] = []
    cn_seen: set[str] = set()
    for x in re.findall(r"[\"'`]([^\"'`]*[\u4e00-\u9fff][^\"'`]*)[\"'`]", source):
        x = " ".join(x.split())
        if x and x not in cn_seen:
            cn_seen.add(x)
            cn.append(x)
    dump("中文文案全量.txt", "\n".join(cn) + "\n")

    # 7) 可选：导出原始 CSS / JS，便于后续拆包与格式化
    if extract_css:
        dump("参考原件-内联CSS.css", "\n".join(extract_blocks(source, "style")))
    if extract_js:
        dump("参考原件-内联JS.js", "\n".join(extract_blocks(source, "script")))

    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="单文件 HTML 结构分析器（纯静态、零网络）")
    # 默认路径基于脚本所在位置推导，避免硬编码绝对路径
    project_root = Path(__file__).resolve().parent.parent
    parser.add_argument(
        "--input", type=Path,
        default=project_root / "00-原文件" / "几猫国产3A大作2.html",
        help="待分析的 HTML 文件",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=project_root / "04-数据",
        help="分析产物输出目录",
    )
    parser.add_argument("--extract-css", action="store_true", help="同时导出内联 CSS 原文")
    parser.add_argument("--extract-js", action="store_true", help="同时导出内联 JS 原文")
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"输入文件不存在：{args.input}")

    source = read_source(args.input)
    result = scan(source, args.input)
    written = write_reports(result, source, args.output_dir, args.extract_css, args.extract_js)

    print(f"分析完成：{args.input}")
    print(f"体积 {result.meta['bytes']:,} 字节 / {result.meta['lines']:,} 行")
    print(f"还原原始模块 {result.modules['total']} 个")
    print(f"输出 {len(written)} 个文件：")
    for p in written:
        print(f"  - {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
