#!/usr/bin/env node
/**
 * 单文件产物离线校验。
 *
 * 口径（与 01-分析/01-参考游戏技术拆解.md 保持一致）：
 *  - **静态扫描 ≠ 运行时行为**。像 fetch( / XMLHttpRequest 这样的字样可能只是
 *    Three.js Loader 的类定义，出现不等于真的发请求，因此只做「报告项」，
 *    最终仍需断网双击 + DevTools Network 面板人工复核。
 *  - 真正会形成网络请求的结构（外链标签、@import、CSS url(http)、未知 http(s) 端点）
 *    一律硬失败。
 *
 * 体积阈值来自 src/01-shared/build-budget.json，与 TS 配置层共用同一份，避免两处硬编码。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 已知无害的 URL 字面量白名单：
 *  - w3.org 系列是 createElementNS 的 XML/SVG 命名空间常量，不是网址、不发包；
 *  - threejs.org 出现在 Three.js 的警告/文档提示字符串里，同样不是资源地址。
 * 新增白名单必须有明确理由，并在报告中留痕。
 */
const URL_WHITELIST_PREFIXES = Object.freeze([
  'http://www.w3.org/1999/xhtml',
  'https://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/svg',
  'https://www.w3.org/2000/svg',
  'http://www.w3.org/XML/1998/namespace',
  'https://threejs.org',
  'http://threejs.org',
]);

const RUNTIME_API_PATTERNS = Object.freeze({
  'fetch(': /fetch\s*\(/g,
  XMLHttpRequest: /XMLHttpRequest/g,
  'WebSocket(': /WebSocket\s*\(/g,
  'EventSource(': /EventSource\s*\(/g,
  sendBeacon: /sendBeacon/g,
  'importScripts(': /importScripts\s*\(/g,
});

export function isWhitelistedUrl(url) {
  return URL_WHITELIST_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** 纯函数：对 HTML 文本做离线断言，返回检查结果。 */
export function inspectHtml(html) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('文件非空', html.trim().length > 0, `${html.length} 字符`);

  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const externalLinks = linkTags.filter((tag) =>
    /\bhref\s*=\s*["']?(?!data:|blob:|#)[^"'\s>]+/i.test(tag),
  );
  add('无外链 <link>', externalLinks.length === 0, externalLinks.slice(0, 3).join(' | ') || '0 个');

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  const externalScripts = scriptTags.filter((tag) => /\bsrc\s*=/i.test(tag));
  add(
    '无 <script src>',
    externalScripts.length === 0,
    externalScripts.slice(0, 3).join(' | ') || '0 个',
  );

  const resourceTags =
    html.match(/<(?:img|iframe|source|video|audio|embed|object|track)\b[^>]*>/gi) ?? [];
  const externalResources = resourceTags.filter((tag) =>
    /\b(?:src|data|poster)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(tag),
  );
  add('无远程资源标签', externalResources.length === 0, `${externalResources.length} 个`);

  add('无 CSS @import', !/@import\b/i.test(html), '未发现 @import');
  add('无 CSS url(http)', !/url\(\s*["']?\s*(?:https?:|\/\/)/i.test(html), '未发现远程 url()');

  const urls = [...new Set(html.match(/https?:\/\/[^\s"'<>()[\]{}`]+/gi) ?? [])];
  const unknownUrls = urls.filter((url) => !isWhitelistedUrl(url));
  add(
    '无未知 http(s) 端点',
    unknownUrls.length === 0,
    unknownUrls.length === 0 ? `白名单内 ${urls.length} 条` : unknownUrls.slice(0, 5).join(' | '),
  );

  const runtimeApiHits = {};
  for (const [name, pattern] of Object.entries(RUNTIME_API_PATTERNS)) {
    pattern.lastIndex = 0;
    const count = (html.match(pattern) ?? []).length;
    if (count > 0) {
      runtimeApiHits[name] = count;
    }
  }

  return { checks, urls, unknownUrls, runtimeApiHits };
}

function parseInputArg(argv) {
  const index = argv.indexOf('--input');
  if (index !== -1 && argv[index + 1] !== undefined) {
    return argv[index + 1];
  }
  return 'dist/single/index.html';
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const inputRelative = parseInputArg(process.argv);
  const inputPath = resolve(projectRoot, inputRelative);

  if (!existsSync(inputPath)) {
    console.error(`[verify-single] 产物不存在：${inputRelative}（先跑 npm run build:single）`);
    process.exitCode = 1;
    return;
  }

  const buffer = readFileSync(inputPath);
  const html = buffer.toString('utf8');
  const budget = JSON.parse(
    readFileSync(join(projectRoot, 'src/01-shared/build-budget.json'), 'utf8'),
  );

  const result = inspectHtml(html);
  const md5 = createHash('md5').update(buffer).digest('hex');
  const overBudget = buffer.length > budget.budgetBytes;
  const overHardLimit = buffer.length > budget.hardLimitBytes;

  const checks = [
    ...result.checks,
    {
      name: '不超过硬上限',
      ok: !overHardLimit,
      detail: `${buffer.length} / ${budget.hardLimitBytes} 字节`,
    },
  ];

  console.log(`[verify-single] ${inputRelative}`);
  console.log(`  体积: ${(buffer.length / 1024 / 1024).toFixed(3)} MiB (${buffer.length} 字节)`);
  console.log(`  MD5 : ${md5}`);
  for (const check of checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}：${check.detail}`);
  }
  if (overBudget && !overHardLimit) {
    console.warn(
      `  ⚠ 超出预算 ${budget.budgetBytes} 字节，但未超硬上限；请考虑裁剪 three 未用模块`,
    );
  }
  if (Object.keys(result.runtimeApiHits).length > 0) {
    console.log(
      `  ℹ 运行时网络 API 字样（仅为提示，不等于发起请求）：${JSON.stringify(result.runtimeApiHits)}`,
    );
    console.log('    仍需断网双击 + DevTools Network 面板复核（静态扫描 ≠ 运行时行为）');
  }

  const passed = checks.every((check) => check.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    input: relative(projectRoot, inputPath).replace(/\\/g, '/'),
    bytes: buffer.length,
    md5,
    budgetBytes: budget.budgetBytes,
    hardLimitBytes: budget.hardLimitBytes,
    overBudget,
    overHardLimit,
    checks,
    urlLiterals: result.urls,
    unknownUrls: result.unknownUrls,
    runtimeApiHits: result.runtimeApiHits,
    passed,
  };
  const reportsDir = join(projectRoot, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, 'single-build.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (!passed) {
    console.error(`[verify-single] 失败：${checks.filter((c) => !c.ok).length} 项未通过`);
    process.exitCode = 1;
  } else {
    console.log('[verify-single] OK：单文件产物通过离线断言，报告写入 reports/single-build.json');
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
