import type { WeatherPreset } from '@/00-types';
import { COPY } from './copy';

/**
 * 天气预设集中描述时段雾倍率、天空色调和程序化降水参数；渲染层只读取这张冻结表。
 */
const NO_PRECIPITATION = Object.freeze({
  effect: 'none',
  particleCount: 0,
  fallSpeed: 0,
  dropLength: 0,
  areaHeight: 0,
  colorHex: 0xffffff,
  opacity: 0,
  audioGain: 0,
} as const);
const CLEAR = Object.freeze({
  id: 'clear',
  label: COPY.weather.clear,
  fogScale: Object.freeze({
    near: 1,
    far: 1,
  } as const),
  skyTintHex: 0xffffff,
  windStrength: 0,
  precipitation: NO_PRECIPITATION,
} as const satisfies WeatherPreset);

const MIST = Object.freeze({
  id: 'mist',
  label: COPY.weather.mist,
  fogScale: Object.freeze({
    near: 0.35,
    far: 0.45,
  } as const),
  skyTintHex: 0xb8c5cc,
  windStrength: 0.2,
  precipitation: NO_PRECIPITATION,
} as const satisfies WeatherPreset);

const RAIN = Object.freeze({
  id: 'rain',
  label: COPY.weather.rain,
  fogScale: Object.freeze({
    near: 0.8,
    far: 0.7,
  } as const),
  skyTintHex: 0x9eafb8,
  windStrength: 0.75,
  precipitation: Object.freeze({
    effect: 'rain',
    particleCount: 180,
    fallSpeed: 13,
    dropLength: 0.65,
    areaHeight: 12,
    colorHex: 0xbdd8e3,
    opacity: 0.48,
    audioGain: 1,
  } as const),
} as const satisfies WeatherPreset);

/** 天气键名与 WeatherId 保持一一对应；雪效留给后续阶段。 */
export const WEATHER_PRESETS = Object.freeze({
  clear: CLEAR,
  mist: MIST,
  rain: RAIN,
} as const satisfies Readonly<Record<WeatherPreset['id'], WeatherPreset>>);

/** 默认晴天保证首次进入先展示基准光照，雾效果由用户主动切换。 */
export const DEFAULT_WEATHER_ID = Object.freeze('clear' as const);
