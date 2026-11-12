#!/usr/bin/env node
/**
 * 架构门禁：强制 src/ 的数字前缀分层保持单向依赖。
 *
 * 为什么自写而不用 eslint-plugin-import：本项目只需要四条很具体的规则，
 * 引入插件与其解析器会带来一堆依赖和配置；零依赖脚本更好维护、CI 也更快。
 * 核心分析函数 analyzeLayers() 是纯函数，接受文件列表，便于单测穷举违规场景。
 *
 * 规则：
 *  1. 低层不得引用高层（编号即等级）；
 *  2. 跨层只能引用目录入口 index，不得深引内部文件；
 *  3. 00-types 不得引用任何 src 内模块；
 *  4. window / document / localStorage 只允许出现在 platform / ui / diagnostics / boot；
 *  5. 模块图不得有环。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAYER_ORDER = Object.freeze([
  '00-types',
  '01-shared',
  '02-core',
  '03-platform',
  '04-engine',
  '05-materials',
  '06-world',
  '07-systems',
  '08-ui',
  '98-diagnostics',
  '99-boot',
]);

const BROWSER_API_ALLOWED_LAYERS = new Set(['03-platform', '08-ui', '98-diagnostics', '99-boot']);
const BROWSER_API_RE = /\b(?:window|document|localStorage)\b/g;
const FROM_RE = /\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
const MODULE_EXT_RE = /\.(?:ts|tsx|js|mjs|json|css)$/;

/** 去掉注释再检查浏览器 API，避免「注释里提到 window」被误判为越界。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function extractImports(source) {
  const found = new Set();
  for (const pattern of [FROM_RE, BARE_IMPORT_RE]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      if (specifier !== undefined) {
        found.add(specifier);
      }
      match = pattern.exec(source);
    }
  }
  return [...found];
}

/** 从形如 `02-core/EventBus.ts` 或 `@/04-engine` 的路径里取层名。 */
function layerNameFromPath(path) {
  const match = path.replace(/\\/g, '/').match(/(?:^|\/)(\d{2}-[a-z][a-z-]*)(?:\/|$)/);
  return match?.[1] ?? null;
}

/** 把 import 说明符解析成相对 src 根的无扩展名路径；外部包返回 null。 */
function resolveSpecifier(filePath, specifier) {
  let target;
  if (specifier.startsWith('@/')) {
    target = specifier.slice(2);
  } else if (specifier.startsWith('.')) {
    target = posix.normalize(posix.join(posix.dirname(filePath), specifier));
  } else {
    return null;
  }
  return target.replace(MODULE_EXT_RE, '');
}

function isLayerEntry(targetPath, layerName) {
  return targetPath === layerName || targetPath === `${layerName}/index`;
}

function findCycles(graph) {
  const cycles = [];
  const state = new Map(); // 0=未访问 1=访问中 2=完成
  const stack = [];

  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 1) {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start === -1 ? 0 : start), next]);
      } else if (nextState === 0) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of graph.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      visit(node);
    }
  }
  return cycles;
}

/**
 * 纯函数：分析一组源码文件。
 * @param {{path: string, source: string}[]} files path 为相对 src 根的路径
 * @returns {{violations: object[], filesScanned: number, importsChecked: number}}
 */
export function analyzeLayers(files) {
  const violations = [];
  const graph = new Map();
  for (const file of files) {
    graph.set(file.path.replace(MODULE_EXT_RE, ''), new Set());
  }

  let importsChecked = 0;
  for (const file of files) {
    const sourceLayer = layerNameFromPath(file.path) ?? '99-boot';
    const isTypesLayer = sourceLayer === '00-types';
    const codeOnly = stripComments(file.source);
    const modulePath = file.path.replace(MODULE_EXT_RE, '');

    // 规则 4：浏览器 API 越界（注释已剥离，只看真实代码）
    if (!BROWSER_API_ALLOWED_LAYERS.has(sourceLayer)) {
      BROWSER_API_RE.lastIndex = 0;
      const hits = new Set(codeOnly.match(BROWSER_API_RE) ?? []);
      if (hits.size > 0) {
        violations.push({
          rule: 'browser-api-leak',
          file: file.path,
          detail: `${sourceLayer} 层出现浏览器 API：${[...hits].join(', ')}`,
        });
      }
    }

    for (const specifier of extractImports(codeOnly)) {
      const targetPath = resolveSpecifier(file.path, specifier);
      if (targetPath === null) {
        continue; // 外部包（three / node 内置等）不参与分层
      }
      importsChecked += 1;
      graph.get(modulePath)?.add(targetPath);

      const targetLayer = layerNameFromPath(targetPath);
      if (targetLayer === null) {
        continue; // 同目录下的非分层文件（如入口 main.ts）
      }

      // 规则 3：声明层不得依赖其它层；同层内部互相引用是允许的（index.ts 需要 re-export）
      if (isTypesLayer && targetLayer !== '00-types') {
        violations.push({
          rule: 'types-layer-dependency',
          file: file.path,
          detail: `00-types 不应依赖其它 src 层：${specifier}`,
        });
        continue;
      }

      const sourceIndex = LAYER_ORDER.indexOf(sourceLayer);
      const targetIndex = LAYER_ORDER.indexOf(targetLayer);
      if (sourceIndex === -1 || targetIndex === -1) {
        violations.push({
          rule: 'unknown-layer',
          file: file.path,
          detail: `未登记的层：${sourceLayer} → ${targetLayer}`,
        });
        continue;
      }

      // 规则 1：禁止向上依赖
      if (targetIndex > sourceIndex) {
        violations.push({
          rule: 'upward-dependency',
          file: file.path,
          detail: `${sourceLayer}(${sourceIndex}) 不得依赖更高层 ${targetLayer}(${targetIndex})：${specifier}`,
        });
        continue;
      }

      // 规则 2：跨层必须走目录入口；CSS 副作用导入不适用模块入口概念
      const crossLayer = targetIndex < sourceIndex;
      const isCssImport = /\.css$/.test(specifier);
      if (crossLayer && !isCssImport && !isLayerEntry(targetPath, targetLayer)) {
        violations.push({
          rule: 'deep-import',
          file: file.path,
          detail: `跨层请引用目录入口 @/${targetLayer}，不得深引 ${specifier}`,
        });
      }
    }
  }

  // 规则 5：环依赖
  for (const cycle of findCycles(graph)) {
    violations.push({
      rule: 'circular-dependency',
      file: cycle[0] ?? '(unknown)',
      detail: `检测到循环依赖：${cycle.join(' → ')}`,
    });
  }

  return { violations, filesScanned: files.length, importsChecked };
}

function collectSourceFiles(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full, base));
    } else if (/\.(?:ts|mjs|js)$/.test(entry.name)) {
      out.push({
        path: relative(base, full).replace(/\\/g, '/'),
        source: readFileSync(full, 'utf8'),
      });
    }
  }
  return out;
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = join(projectRoot, 'src');
  const files = collectSourceFiles(srcDir, srcDir);
  const result = analyzeLayers(files);

  console.log(
    `[check-layers] 扫描 ${result.filesScanned} 个文件，检查 ${result.importsChecked} 条内部 import`,
  );
  if (result.violations.length === 0) {
    console.log('[check-layers] OK：分层方向、模块入口、浏览器 API 边界、循环依赖均通过');
    return;
  }
  for (const item of result.violations) {
    console.error(`  ✗ [${item.rule}] ${item.file} — ${item.detail}`);
  }
  console.error(`[check-layers] 失败：${result.violations.length} 处违规`);
  process.exitCode = 1;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
