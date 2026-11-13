import type { QualityTier, TimeOfDayId } from '@/00-types';

export const LAND_TIMES = ['dawn', 'noon', 'dusk'] as const;

/** 光照、空气透视与材质共用的美术参数；颜色均为 sRGB 输入，混合时转为线性空间。 */
export const LAND_ATMOSPHERE = Object.freeze({
  transitionMs: 3200,
  sky: { radius: 1400, cloudSpeed: 0.002, cloudStrength: 0.62 },
  haze: { start: 100, density: 0.00325, heightFalloff: 0.018 },
  water: { extent: 5000, reflection: 0.39, fresnel: 0.44, highlight: 0.32 },
  shadow: { span: 114, near: 1, far: 560, bias: -0.00008, normalBias: 0.025 },
  fill: { sky: 0xdfebe6, ground: 0x8d9e92, color: 0xe7eee4, position: [45, 65, 95] },
  interior: { color: 0xffe0ae, intensity: 105, distance: 44, position: [0, 13, -40] },
  contact: { textureSize: 128, opacity: 0.22, color: 0x22372e, radiusRatio: 2.35, lift: 0.012 },
  environment: { size: 256, blur: 0.06, intensity: 0.68 },
} as const);

export const LAND_LIGHT_QUALITY: Readonly<Record<QualityTier, { shadowHz: number }>> = {
  low: { shadowHz: 0 },
  medium: { shadowHz: 0 },
  high: { shadowHz: 20 },
  ultra: { shadowHz: 24 },
};

export const LAND_LIGHT: Readonly<
  Record<
    TimeOfDayId,
    {
      label: string;
      top: number;
      horizon: number;
      fog: number;
      sun: number;
      sunIntensity: number;
      ambient: number;
      fill: number;
      exposure: number;
      sunPosition: readonly [number, number, number];
    }
  >
> = Object.freeze({
  dawn: {
    label: '晨光',
    top: 0x789fae,
    horizon: 0xead9bf,
    fog: 0xd7dbd2,
    sun: 0xffe2b8,
    sunIntensity: 2.65,
    ambient: 1.5,
    fill: 0.95,
    exposure: 0.95,
    sunPosition: [-100, 90, -120],
  },
  noon: {
    label: '晴昼',
    top: 0x679db4,
    horizon: 0xe0e9e4,
    fog: 0xd6e2de,
    sun: 0xfff4df,
    sunIntensity: 3,
    ambient: 1.65,
    fill: 0.85,
    exposure: 0.92,
    sunPosition: [-100, 170, 70],
  },
  dusk: {
    label: '落照',
    top: 0x6e8497,
    horizon: 0xebcbaa,
    fog: 0xd2cdc0,
    sun: 0xffd0a0,
    sunIntensity: 2.6,
    ambient: 1.35,
    fill: 1.05,
    exposure: 0.94,
    sunPosition: [-130, 75, -105],
  },
});
