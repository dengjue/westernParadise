import type { CameraMode, PlatformParams, QualityTier, TimeOfDayId, WeatherId } from '@/00-types';
import {
  DEFAULT_SEED,
  DEFAULT_TIME_OF_DAY_ID,
  DEFAULT_WEATHER_ID,
  QUALITY_ORDER,
  TIME_OF_DAY_PRESETS,
  WEATHER_PRESETS,
} from '@/01-shared';

export type ParamsWarning = (message: string) => void;

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

const defaultWarning: ParamsWarning = (message) => {
  console.warn(`[parseParams] ${message}`);
};

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

function parseTimeOfDay(raw: string | null, warn: ParamsWarning): TimeOfDayId {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') {
    return DEFAULT_TIME_OF_DAY_ID;
  }
  if (Object.hasOwn(TIME_OF_DAY_PRESETS, normalized)) {
    return normalized as TimeOfDayId;
  }
  warn(`非法 tod 参数「${raw}」，已回落到 ${DEFAULT_TIME_OF_DAY_ID}`);
  return DEFAULT_TIME_OF_DAY_ID;
}

function parseWeather(raw: string | null, warn: ParamsWarning): WeatherId {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') {
    return DEFAULT_WEATHER_ID;
  }
  if (Object.hasOwn(WEATHER_PRESETS, normalized)) {
    return normalized as WeatherId;
  }
  warn(`非法 weather 参数「${raw}」，已回落到 ${DEFAULT_WEATHER_ID}`);
  return DEFAULT_WEATHER_ID;
}

function parseCameraMode(raw: string | null, warn: ParamsWarning): CameraMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized === '' || normalized === 'first') {
    return 'first';
  }
  if (normalized === 'third') {
    return 'third';
  }
  warn(`非法 cam 参数「${raw}」，已回落到 first`);
  return 'first';
}

export function parseParams(search: string, warn: ParamsWarning = defaultWarning): PlatformParams {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return Object.freeze({
    quality: parseQuality(params.get('quality') ?? params.get('q')),
    tod: parseTimeOfDay(params.get('tod'), warn),
    weather: parseWeather(params.get('weather'), warn),
    seed: parseSeed(params.get('seed')),
    bench: flag(params, 'bench'),
    smoke: flag(params, 'smoke'),
    debug: flag(params, 'debug'),
    noAudio: flag(params, 'noaudio'),
    cam: parseCameraMode(params.get('cam'), warn),
  });
}
