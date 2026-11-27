# Phase 1 · 性能基线与等画质几何减负

状态：已完成（2026-11-13）。前置版本：`ab591f6`。本轮用户已授权直接推进。

## 1. 目标

用同一套采样方法量化优化前后差异，在不减少构件、三角形、树叶和莲花数量的前提下，减少静态几何缓冲和构建时的中间展开数据。

## 2. 已知根因

`src/06-world/land/Builder.ts` 为合并不同构件，将所有几何转换为非索引形式。Three.js 的 `mergeGeometries` 实际支持多种形状的索引几何，只要求属性结构和索引存在性一致。球面、管线和屋面因此产生了不必要的顶点重复。

同一位置上的法线或 UV 可能不同；优化必须保留这些边界，不能仅按位置焊接顶点，以免磨平柱础棱角、破坏瓦面和贴图接缝。

## 3. 实施清单

1. 建立 `scripts/benchmark-pure-land.mjs`，供 Tabbit/Playwright 调用：四固定机位、60 帧预热、180 帧采样、返回 JSON。
2. 采样 `ab591f6` 生产 HTML 的 high、low；将完整本机报告保存在 `reports/`，文档记录口径和摘要。
3. `LandBuilder` 保留已有索引；遇到非索引输入时仅补顺序索引。合批后建立包围盒/球，便于后续分块裁剪。
4. 输入几何由调用方持有；Builder 只释放自己的副本。合并失败需给出可诊断错误，避免静默丢构件。
5. 补充有意义的回归测试：不同几何合批后的三角形属性一致、UV/法线接缝保留、非索引输入、超过 16 位索引范围、大批次缓冲节省。
6. `?bench` 明确开启诊断对象，生产默认关闭；采样器订阅仅在采样期间存在，完成/失败均解除。
7. 构建后用完全相同的采样器、种子和视口复测；检查四景点、三光阴、漫游和离线加载。

## 4. 变更位置

- `src/06-world/land/Builder.ts`：索引合批与临时资源管理。
- `src/99-boot/pureLand.ts`：bench 入口。
- `scripts/benchmark-pure-land.mjs`：可复跑采样与按资源去重的几何字节统计。
- `tests/landBuilder.test.ts`：合批语义、边界与内存预算回归。
- `README.md` / `CHANGELOG.md` / `AGENT_TODO.md`：使用方法、验收与状态。

## 5. 验收标准

- [x] 静态批次几何缓冲字节比基线下降至少 50%；同时记录全场几何和实例缓冲。
- [x] 同档同景点的三角形提交数与 draw calls 保持基线；如有差异须解释。
- [x] 位置、法线、UV 与三角形顺序保持；构件未丢失、阴影和水反射正常。
- [x] high/low 四景点前后报告完整；p95 帧间隔波动按设备现象说明，不宣称没有测量的 GPU 加速。
- [x] `npm run verify` 通过，单文件仍符合体积预算。
- [x] 最终 HTML 断网实际加载，HTTP(S) 请求与运行错误均为零。

## 6. 复跑方式

用 Tabbit 打开生产 `dist/single/index.html?q=high&tod=dusk&seed=20261113&bench`，调用采样脚本的 `benchmarkPureLand(page)`。low 单独重载后再采样；不要让后台页面、开发热更新或临时切换画质混入同一组数据。

下面从项目根目录执行，并通过 `PROJECT_ROOT` 传入仓库路径，以免在可公开的复跑说明里写入本机绝对用户目录。重复运行时使用新的 request-id；将 `q=high` 换成 `q=low` 可复测低档。

```bash
PROJECT_ROOT="$PWD" "$HOME/.local/bin/tabbit-cli" nodejs --task "极乐世界性能基准" --request-id sample-high --timeout-ms 120000 <<'JS'
const root = process.env.PROJECT_ROOT;
if (!root) throw new Error('请设置 PROJECT_ROOT 为仓库根目录');
const { pathToFileURL } = await import('node:url');
const { writeFile } = await import('node:fs/promises');
const { benchmarkPureLand } = await import(pathToFileURL(`${root}/scripts/benchmark-pure-land.mjs`).href);
const url = pathToFileURL(`${root}/dist/single/index.html`);
url.search = '?q=high&tod=dusk&seed=20261113&bench';
await page.goto(url.href, { waitUntil: 'load' });
const report = await benchmarkPureLand(page);
await writeFile(`${root}/reports/benchmark-high.json`, JSON.stringify(report, null, 2));
return report;
JS
"$HOME/.local/bin/tabbit-cli" finish --task "极乐世界性能基准"
```

采样器可传 `sampleTimeoutMs` 延长低帧率环境的截止时间；帧数和预热规则仍保持不变。后台切页会使本组数据作废并解除订阅。

## 7. 实测结果

环境：本机 macOS / Tabbit（Chromium 156），CSS 视口 1601 × 997，DPR 2；high 实际渲染比率 1.5，low 为 1。生产 HTML、seed=20261113、落照、正常动效。每景点预热 60 帧、采样 180 帧。

| 指标 | high 优化前 → 后 | low 优化前 → 后 |
|---|---|---|
| 静态批次缓冲 | 101,399,616 → 37,256,028 字节 | 98,493,504 → 36,284,572 字节 |
| 静态批次缓冲（MiB） | 96.70 → 35.53，减少 **63.26%** | 93.93 → 34.60，减少 **63.16%** |
| 静态存储顶点 | 3,168,738 → 797,808，减少 74.82% | 3,077,922 → 778,802，减少 74.70% |
| 静态三角形 | 1,056,246 → 1,056,246 | 1,025,974 → 1,025,974 |
| 全场几何缓冲 | 101,433,136 → 37,289,548 字节 | 98,523,424 → 36,314,492 字节 |
| 实例缓冲 | 1,574,464 → 1,574,464 字节 | 462,560 → 462,560 字节 |
| 全景每帧 draw calls | 55 → 55 | 41 → 41 |
| 全景每帧提交三角形 | 3,299,628 → 3,299,628 | 2,504,974 → 2,504,974 |

主殿机位分别为 high 54 / low 40 calls，其余三个景点与全景相同；所有景点的前后提交计数均一致。以上缓冲是 CPU 侧几何/实例数组的有效字节统计，不包含纹理、帧缓冲、驱动开销，不能等同于总显存。

| p95 帧间隔（ms） | 全境 | 莲池 | 宝殿 | 宝林 |
|---|---|---|---|---|
| high 优化前 | 16.8 | 16.6 | 9.7 | 15.6 |
| high 优化后 | 8.5 | 16.6 | 16.6 | 9.2 |
| low 优化前 | 10.3 | 9.5 | 9.7 | 10.2 |
| low 优化后 | 8.5 | 16.6 | 16.7 | 8.4 |

大多数景点 p50 约 8.3ms，受当前显示刷新节奏限制。中途另一个项目的覆盖率测试使 CPU 满载，旧版和新版都出现百毫秒级帧间隔，并导致一轮采样超时；该轮未混入上述完整报告。完整复测仍有系统调度长尾，因此本阶段确认的是**几何缓冲减少与可见结果一致**，不将单轮 p95 差值解释为 GPU 性能提升。

### 画面与功能证据

- 固定同机位、同 seed、减动效模式，优化前后 3202 × 1994 全景 PNG 的 SHA-256 完全一致；这证明该机位画面未受索引转换影响。
- 四景点与晨/昼/暮切换正常；W 键步行 z 从 85 到 83.93；平面反射、阴影和材质无错误。
- 最终生产文件在 CDP offline=true 下加载，HTTP(S) 请求 0、脚本/控制台错误 0。无参数时无 `__G`，`?bench` 时诊断对象可用。
- 采样结束后事件订阅数恢复，未留下常驻采样器。
- `npm run verify` 通过：17 个测试文件 / 93 个用例。单文件 723,423 字节，仍在预算内；机器指纹见 `reports/single-build.json`。

本机证据：`reports/phase1-before.json`、`phase1-after.json`、`phase1-browser-checks.json`、`phase1-before-overview.png`、`phase1-after-overview.png`。基线副本为 `reports/phase1-baseline.html`；这些可再生产物不入 Git。
