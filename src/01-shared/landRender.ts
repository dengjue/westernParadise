import type { QualityTier } from '@/00-types';

/** 米制距离、渲染层与像素策略集中在此；显式画质只启用空间/距离优化。 */
export const LAND_RENDER = Object.freeze({
  cellSize: 48,
  cellCandidates: [24, 48],
  layers: { main: 0, reflection: 1, shadow: 2 },
  lod: {
    roof: { distances: [65, 150], hysteresis: 8 },
    sculpture: { distances: [65, 135], hysteresis: 8 },
    plant: { distances: [38, 85], hysteresis: 6 },
    leafRatios: [1, 0.64, 0.34],
    reflectionMinimum: 1,
    sphereSegments: { near: [16, 12], middle: [10, 8], far: [6, 4] },
  },
  decoration: {
    near: { curlStep: 1, haloStep: 1 },
    middle: { curlStep: 2, haloStep: 2 },
    far: { curlStep: 3, haloStep: 4 },
  },
  reflection: { matrixTolerance: 0.000001 },
  adaptive: {
    slowMs: 25,
    fastMs: 17,
    lowerAfterMs: 2400,
    raiseAfterMs: 10000,
    cooldownMs: 6000,
    ignoreOverMs: 150,
    step: 0.1,
    minimum: 0.7,
  },
  timerQueries: 4,
} as const);

export const LAND_RENDER_QUALITY: Readonly<
  Record<
    QualityTier,
    {
      reflectionHz: number;
      postPixelRatio: number;
      samples: number;
    }
  >
> = Object.freeze({
  low: { reflectionHz: 15, postPixelRatio: 1, samples: 0 },
  medium: { reflectionHz: 20, postPixelRatio: 1, samples: 0 },
  high: { reflectionHz: 24, postPixelRatio: 1, samples: 2 },
  ultra: { reflectionHz: 30, postPixelRatio: 1.25, samples: 2 },
});
