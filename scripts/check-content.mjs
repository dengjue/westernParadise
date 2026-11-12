#!/usr/bin/env node
/**
 * 内容红线词门禁。
 *
 * 把 02-方案/03-风险与合规红线.md 第 3 节「绝对不做」清单转成可执行断言，
 * 防止后续迭代时无意把仪式、募捐、占卜、教义类内容加回代码或文案。
 *
 * 口径必须说清楚：
 *  - 这是**关键词提示**，不是内容审查，更不是法律意见；
 *  - 只扫描会被打进产物的文件（src / index.html / dist/single），
 *    不扫描 md 文档（文档里本来就要列举这些词用于说明红线）；
 *  - 词表本身在 scripts/ 下，不在扫描范围内。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_TERMS = Object.freeze([
  // 仪式模拟
  '上香',
  '跪拜',
  '礼佛',
  '叩首',
  '诵经',
  '念咒',
  '敲钟祈福',
  '供灯',
  '供佛',
  '放生',
  '法会',
  '受戒',
  '洒净',
  '拜佛',
  '烧香',
  // 募捐与付费
  '功德箱',
  '香火钱',
  '付费祈福',
  '募捐',
  '香火',
  '功德',
  // 教义内容
  '讲经',
  '讲道',
  '教义',
  '经文',
  '唱念',
  // 占卜类
  '抽签',
  '解签',
  '算命',
  '求签',
  '测吉凶',
  // 常见祈愿类 UI 词
  '祈福',
  '开光',
  '护佑',
  '加持',
  '修行',
  '还愿',
]);

/** 扫描单份文本，返回命中项（含行号与截断后的原文，便于定位）。 */
export function scanText(filename, source) {
  const hits = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const term of FORBIDDEN_TERMS) {
      if (line.includes(term)) {
        hits.push({
          file: filename,
          line: index + 1,
          term,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }
  });
  return hits;
}

function collectSourceFiles(dir, base) {
  const out = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full, base));
    } else if (/\.(?:ts|css|html)$/.test(entry.name)) {
      out.push(relative(base, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

/** 收集需要扫描的相对路径列表。 */
export function collectTargets(projectRoot) {
  const targets = collectSourceFiles(join(projectRoot, 'src'), projectRoot);
  for (const extra of ['index.html', 'dist/single/index.html']) {
    if (existsSync(join(projectRoot, extra))) {
      targets.push(extra);
    }
  }
  return targets;
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const targets = collectTargets(projectRoot);
  const hits = [];
  for (const target of targets) {
    const source = readFileSync(join(projectRoot, target), 'utf8');
    hits.push(...scanText(target, source));
  }

  console.log(
    `[check-content] 扫描 ${targets.length} 个产物相关文件，红线词 ${FORBIDDEN_TERMS.length} 个`,
  );
  if (hits.length === 0) {
    console.log('[check-content] OK：未发现红线词');
    return;
  }
  for (const hit of hits) {
    console.error(`  ✗ ${hit.file}:${hit.line} 命中「${hit.term}」 → ${hit.excerpt}`);
  }
  console.error(`[check-content] 失败：${hits.length} 处命中，请人工确认后改写文案`);
  process.exitCode = 1;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
