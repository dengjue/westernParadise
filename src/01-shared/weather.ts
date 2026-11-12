import type { WeatherPreset } from '@/00-types';
import { COPY } from './copy';

/**
 * 天气预设只调整时段雾的倍率与天空色调；M1 不创建粒子或风场，windStrength 先保留
 * 接口位置，避免阶段 3 引入雨雪时重新改动事件和配置契约。
 */
const CLEAR = Object.freeze({
  id: 'clear',
  label: COPY.weather.clear,
  fogScale: Object.freeze({
    near: 1,
    far: 1,
  } as const),
  skyTintHex: 0xffffff,
  windStrength: 0,
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
} as const satisfies WeatherPreset);

/** 晴/雾是 M1 唯一的天气组合，键名与 WeatherId 保持一一对应。 */
export const WEATHER_PRESETS = Object.freeze({
  clear: CLEAR,
  mist: MIST,
} as const satisfies Readonly<Record<WeatherPreset['id'], WeatherPreset>>);

/** 默认晴天保证首次进入先展示基准光照，雾效果由用户主动切换。 */
export const DEFAULT_WEATHER_ID = Object.freeze('clear' as const);
