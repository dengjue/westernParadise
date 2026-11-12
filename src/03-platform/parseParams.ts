import type { PlatformParams, QualityTier } from '@/00-types';
import { DEFAULT_SEED, QUALITY_ORDER } from '@/01-shared';

/**
 * 解析 URL 调试参数。
 *
 * 刻意做成接受字符串的纯函数（不读 location）：单测可以直接喂各种输入，
 * 也避免同一个参数在多个模块里被解析出不同语义。
 *
 * 约定：
 * - 开关类参数 `?bench` 出现即为 true；显式写 `?bench=0` / `=false` 才关闭。
 * - 非法值一律回退到默认值，**绝不抛错**。调试参数不该让页面白屏。
 */

const FALSE_TOKENS: ReadonlySet<string> = new Set(['0', 'false', 'off', 'no']);

function flag(params: URLSearchParams, name: string): boolean {
  if (!params.has(name)) {
    return false;
  }
  const value = params.get(name);
  return value === null || value === '' || !FALSE_TOKENS.has(value.toLowerCase());
}

function parseQuality(raw: string | null): QualityTier | null {
  if (raw === null) {
    return null;
  }
  return QUALITY_ORDER.find((tier) => tier === raw.toLowerCase()) ?? null;
}

function parseSeed(raw: string | null): number {
  if (raw === null || raw.trim() === '') {
    return DEFAULT_SEED;
  }
  const value = Number(raw);
  // 只接受有限非负整数；小数、NaN、Infinity、负数全部回退。
  if (!Number.isSafeInteger(value) || value < 0) {
    return DEFAULT_SEED;
  }
  return value >>> 0;
}

export function parseParams(search: string): PlatformParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return Object.freeze({
    quality: parseQuality(params.get('quality') ?? params.get('q')),
    seed: parseSeed(params.get('seed')),
    bench: flag(params, 'bench'),
    smoke: flag(params, 'smoke'),
    debug: flag(params, 'debug'),
    noAudio: flag(params, 'noaudio'),
  });
}
