import type { TimeOfDayPreset } from '@/00-types';
import { COPY } from './copy';

/**
 * 晨、午、暮采用整组离散预设，避免 M1 在渲染器里引入连续插值和额外状态机。
 * 每档的天空、雾和曝光与太阳参数一起替换，保证切换时不会出现跨时段的混合状态。
 */
const DAWN = Object.freeze({
  id: 'dawn',
  label: COPY.timeOfDay.dawn,
  sun: Object.freeze({
    elevationDeg: 12,
    azimuthDeg: 105,
    colorHex: 0xffd9a0,
    intensity: 2,
  } as const),
  ambient: Object.freeze({
    colorHex: 0xffb8a2,
    intensity: 0.55,
  } as const),
  skyTopHex: 0x6f8194,
  skyBottomHex: 0xe7c49f,
  fog: Object.freeze({
    colorHex: 0xb0b6b2,
    near: 12,
    far: 100,
  } as const),
  exposure: 0.9,
} as const satisfies TimeOfDayPreset);

const NOON = Object.freeze({
  id: 'noon',
  label: COPY.timeOfDay.noon,
  sun: Object.freeze({
    elevationDeg: 68,
    azimuthDeg: 170,
    colorHex: 0xfff4e0,
    intensity: 3,
  } as const),
  ambient: Object.freeze({
    colorHex: 0xffffff,
    intensity: 0.75,
  } as const),
  skyTopHex: 0x6a9bc4,
  skyBottomHex: 0xdbe9ef,
  fog: Object.freeze({
    colorHex: 0xaebfc5,
    near: 28,
    far: 180,
  } as const),
  exposure: 1.05,
} as const satisfies TimeOfDayPreset);

const DUSK = Object.freeze({
  id: 'dusk',
  label: COPY.timeOfDay.dusk,
  sun: Object.freeze({
    elevationDeg: 9,
    azimuthDeg: 262,
    colorHex: 0xff9d5c,
    intensity: 1.8,
  } as const),
  ambient: Object.freeze({
    colorHex: 0x6f5964,
    intensity: 0.5,
  } as const),
  skyTopHex: 0x3f4b68,
  skyBottomHex: 0xd47b5e,
  fog: Object.freeze({
    colorHex: 0x8a6a68,
    near: 10,
    far: 110,
  } as const),
  exposure: 0.9,
} as const satisfies TimeOfDayPreset);

/** 三档键名与 ID 共用同一张表，便于后续按 URL 或事件载荷直接索引。 */
export const TIME_OF_DAY_PRESETS = Object.freeze({
  dawn: DAWN,
  noon: NOON,
  dusk: DUSK,
} as const satisfies Readonly<Record<TimeOfDayPreset['id'], TimeOfDayPreset>>);

/** 默认午间光照让首次进入时辨识度最高，后续由 boot/UI 通过事件切换。 */
export const DEFAULT_TIME_OF_DAY_ID = Object.freeze('noon' as const);
