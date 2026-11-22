import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * 双产物构建配置。
 *
 * - 默认 mode (production) → dist/site/：常规多文件产物，可部署静态站。
 * - mode=single           → dist/single/index.html：CSS/JS 全内联，供离线双击与转发。
 *
 * 单文件模式的关键点：base 必须是相对路径（file:// 打开才不会失效）、
 * CSS 不能拆分、任何资源都不允许落成独立文件、动态 import 必须内联。
 * 这四条缺一条，产物就会出现外部请求，破坏「零外链」验收口径。
 */
const SINGLE_INLINE_LIMIT_BYTES = 100 * 1024 * 1024;

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const multiplayer = mode === 'multiplayer';
  const lanOrigin = process.env.COURTYARD_DEPLOY_ORIGIN;
  if (multiplayer && !lanOrigin) throw new Error('COURTYARD_DEPLOY_ORIGIN is required');

  return {
    base: './',
    define: multiplayer
      ? { 'import.meta.env.COURTYARD_LAN_ORIGIN': JSON.stringify(lanOrigin) }
      : {},
    assetsInclude: ['**/*.gz', '**/*.gz?inline'],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      outDir: multiplayer ? 'dist/multiplayer' : single ? 'dist/single' : 'dist/site',
      emptyOutDir: true,
      target: 'es2022',
      // 单文件产物不带 source map：既是体积考虑，也避免生成额外 .map 文件形成外链。
      sourcemap: !single && !multiplayer,
      cssCodeSplit: !single,
      assetsInlineLimit: single ? SINGLE_INLINE_LIMIT_BYTES : 4096,
      // three 单独分包约 534 kB，是有意设计（便于浏览器长期缓存），
      // 阈值设到 600 kB 只为容纳它；业务 chunk 若逼近该值就说明该做拆分了。
      chunkSizeWarningLimit: 600,
      // Vite 8 / Rolldown 默认 codeSplitting: false，单文件模式天然只产出一个 chunk。
      // 早期写的 inlineDynamicImports 在该版本会被忽略并打印 WARN，故不再配置：
      // 真正兜底的是 scripts/verify-single.mjs 的零外链断言 —— 一旦将来构建器
      // 把代码拆成多个 chunk，产物会多出 <script src>，门禁会立刻失败。
      // 站点模式则把体积最大的 three 单独分包；新版 Rollup 的 manualChunks
      // 只接受函数，返回 undefined 表示交回默认分包策略。
      rollupOptions: single
        ? {}
        : {
            output: {
              manualChunks: (id: string) =>
                id.includes('/node_modules/three/') ? 'three' : undefined,
            },
          },
    },
    plugins: single ? [viteSingleFile()] : [],
  };
});
