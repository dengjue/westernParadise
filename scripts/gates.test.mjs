/**
 * 门禁脚本自身的回归测试（fixture 驱动）。
 *
 * 为什么要测门禁：一个「永远返回通过」的门禁比没有门禁更危险。
 * 这里故意构造各类违规，断言对应的 rule 真的被抓到；同时构造边界样例，
 * 断言「合法的写法不会被误伤」——后者决定了门禁能不能长期留在项目里。
 *
 * 三个脚本都把分析逻辑写成导出纯函数，因此无需造临时文件、无需起子进程。
 */
import { describe, expect, it } from 'vitest';
import { analyzeLayers, LAYER_ORDER } from './check-layers.mjs';
import { FORBIDDEN_TERMS, scanText } from './check-content.mjs';
import { inspectHtml, isWhitelistedUrl } from './verify-single.mjs';

/** 构造单个 fixture 文件，path 相对 src 根。 */
const file = (path, source) => ({ path, source });

/** 从结果里取指定规则名。 */
const rules = (result) => result.violations.map((item) => item.rule);

describe('check-layers · 违规必须被抓到', () => {
  it('低层引用高层 → upward-dependency', () => {
    const result = analyzeLayers([file('02-core/Foo.ts', "import { bar } from '@/04-engine';")]);
    expect(rules(result)).toContain('upward-dependency');
  });

  it('跨层深引内部文件 → deep-import', () => {
    const result = analyzeLayers([
      file('04-engine/X.ts', "import { EventBus } from '@/02-core/EventBus';"),
    ]);
    expect(rules(result)).toContain('deep-import');
  });

  it('核心层出现 window → browser-api-leak', () => {
    const result = analyzeLayers([file('02-core/X.ts', 'export const w = window.innerWidth;')]);
    expect(rules(result)).toContain('browser-api-leak');
  });

  it('00-types 依赖其它层 → types-layer-dependency', () => {
    const result = analyzeLayers([
      file('00-types/contracts.ts', "import type { X } from '@/01-shared';"),
    ]);
    expect(rules(result)).toContain('types-layer-dependency');
  });

  it('互相引用 → circular-dependency', () => {
    const result = analyzeLayers([
      file('02-core/A.ts', "export { b } from './B';"),
      file('02-core/B.ts', "export { a } from './A';"),
    ]);
    expect(rules(result)).toContain('circular-dependency');
  });
});

describe('check-layers · 合法写法不得误伤', () => {
  it('正常单向依赖 + 目录入口 → 零违规', () => {
    const result = analyzeLayers([
      file('00-types/index.ts', "export type { A } from './contracts';"),
      file(
        '04-engine/X.ts',
        "import type { A } from '@/00-types';\nimport { APP } from '@/01-shared';",
      ),
      file('99-boot/index.ts', "import { X } from '@/04-engine';"),
    ]);
    expect(result.violations).toEqual([]);
  });

  it('注释里提到 window 不算越界', () => {
    const result = analyzeLayers([
      file(
        '02-core/X.ts',
        '// 本层刻意不碰 window / document\n/* localStorage 由 platform 层负责 */\nexport const x = 1;',
      ),
    ]);
    expect(result.violations).toEqual([]);
  });

  it('00-types 同层内部 re-export 是允许的', () => {
    const result = analyzeLayers([
      file(
        '00-types/index.ts',
        "export type { A } from './contracts';\nexport type { B } from './events';",
      ),
    ]);
    expect(result.violations).toEqual([]);
  });

  it('CSS 副作用导入不受「目录入口」规则约束', () => {
    const result = analyzeLayers([file('08-ui/mount.ts', "import '@/08-ui/tokens.css';")]);
    expect(rules(result)).not.toContain('deep-import');
  });

  it('外部包导入不参与分层，且层序表完整有序', () => {
    const result = analyzeLayers([
      file(
        '06-world/X.ts',
        "import * as THREE from 'three';\nimport { readFileSync } from 'node:fs';",
      ),
    ]);
    expect(result.violations).toEqual([]);
    expect(LAYER_ORDER[0]).toBe('00-types');
    expect(LAYER_ORDER.at(-1)).toBe('99-boot');
  });
});

describe('check-content · 红线词门禁', () => {
  it('命中仪式类词时返回文件名、行号与词（重叠词各记一次）', () => {
    const hits = scanText('src/copy.ts', ['const a = 1;', 'export const s = "功德箱";'].join('\n'));
    // 词表同时含「功德」与「功德箱」，子串重叠会分别记录——这是刻意的提示行为，
    // 便于一次性把所有相关表述都改掉，不在此处做去重。
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.map((hit) => hit.term)).toContain('功德箱');
    expect(hits.every((hit) => hit.file === 'src/copy.ts' && hit.line === 2)).toBe(true);
  });

  it('中性技术文案零命中', () => {
    expect(scanText('src/a.ts', 'export const label = "庭院漫游";')).toEqual([]);
  });

  it('同一行多个词分别记录，便于一次性修完', () => {
    const hits = scanText('src/a.ts', 'export const s = "抽签 解签";');
    expect(hits.map((hit) => hit.term)).toEqual(['抽签', '解签']);
  });

  it('词表非空且无重复项', () => {
    expect(FORBIDDEN_TERMS.length).toBeGreaterThan(10);
    expect(new Set(FORBIDDEN_TERMS).size).toBe(FORBIDDEN_TERMS.length);
  });
});

describe('verify-single · 零外链断言', () => {
  const cleanHtml =
    '<!doctype html><html><head><style>body{color:#fff}</style></head>' +
    '<body><canvas></canvas><script>const x=1;</script></body></html>';

  const failed = (html) =>
    inspectHtml(html)
      .checks.filter((check) => !check.ok)
      .map((check) => check.name);

  it('干净产物全部通过', () => {
    expect(failed(cleanHtml)).toEqual([]);
  });

  it('外链 <script src> / <link> / 远程图片分别被抓到', () => {
    expect(failed('<script src="https://cdn.example.com/a.js"></script>')).toContain(
      '无 <script src>',
    );
    expect(failed('<link rel="stylesheet" href="https://cdn.example.com/a.css">')).toContain(
      '无外链 <link>',
    );
    expect(failed('<img src="https://cdn.example.com/a.png">')).toContain('无远程资源标签');
  });

  it('CSS @import / url(http) / 未知端点被抓到', () => {
    expect(failed('<style>@import url(https://cdn.example.com/a.css);</style>')).toContain(
      '无 CSS @import',
    );
    expect(failed('<style>body{background:url(https://cdn.example.com/a.png)}</style>')).toContain(
      '无 CSS url(http)',
    );
    expect(failed('<script>fetch("https://api.example.com/v1")</script>')).toContain(
      '无未知 http(s) 端点',
    );
  });

  it('XML 命名空间常量等白名单 URL 不误报', () => {
    expect(isWhitelistedUrl('http://www.w3.org/1999/xhtml')).toBe(true);
    expect(isWhitelistedUrl('https://threejs.org/docs/')).toBe(true);
    expect(isWhitelistedUrl('https://cdn.example.com/a.js')).toBe(false);
    expect(
      failed('<script>createElementNS("http://www.w3.org/1999/xhtml","div")</script>'),
    ).toEqual([]);
  });

  it('运行时 API 字样只报告不失败（静态扫描 ≠ 实际发包）', () => {
    // 相对路径不构成 http(s) 端点，因此零外链断言仍应全部通过；
    // 但 fetch/XMLHttpRequest 字样要如实记进报告，提醒人工做 Network 面板复核。
    const result = inspectHtml('<script>const C = XMLHttpRequest; fetch("./local.json");</script>');
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.runtimeApiHits['fetch(']).toBeGreaterThan(0);
    expect(result.runtimeApiHits.XMLHttpRequest).toBe(1);
  });
});
