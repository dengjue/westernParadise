import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 测试只覆盖 00–03 层的纯逻辑，环境用 node，不引入 jsdom。
 * 这是刻意的架构约束：浏览器 API 被隔离在 platform / ui / boot 层，
 * 核心逻辑因此可以在无 DOM 环境下直接测试，也不需要截图类脆弱断言。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // 门禁脚本自身也用 fixture 做回归测试，确保「故意写的违规」真的会被抓到。
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
