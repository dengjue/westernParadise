import type { QualityTier } from '@/00-types';

/** 园林的布局与画质解耦：画质只改变细分与稳定细节子集，不改变树干和花心。 */
export const LAND_GARDEN = Object.freeze({
  streams: {
    skeleton: 0x54524545,
    leaf: 0x4c454146,
    lotus: 0x4c4f5455,
    lily: 0x4c494c59,
    ornament: 0x50454152,
  },
  trees: {
    rows: 7,
    lanes: [30, 47],
    startZ: -9,
    spacing: 12.4,
    height: [8.8, 11.8],
    radius: [3.1, 4.05],
    branches: 10,
    twigs: 3,
    island: { halfWidth: 3.05, stoneY: 0.2, stoneHeight: 1.2, rimY: 0.82, topY: 0.91 },
    trunkRadius: 0.28,
    branchRadius: 0.074,
    twigRadius: 0.022,
    leaderReach: 0.12,
    twigRise: [-0.38, 0.76],
    leaf: {
      length: 1.35,
      halfWidth: 0.37,
      cup: 0.12,
      droop: 0.17,
      scale: [0.52, 0.96],
      pitch: [0.15, 2.65],
      roll: [-1, 1],
    },
    hue: [0.19, 0.29],
    saturation: [0.28, 0.44],
    lightness: [0.48, 0.67],
    shadowScale: [1.15, 0.65, 1.05],
  },
  pond: { minX: 10, maxX: 55, minZ: -17, maxZ: 73, clearance: 0.16, attempts: 320 },
  lotus: {
    count: 144,
    size: [0.62, 1.12],
    openness: [0.58, 1.04],
    stemHeight: [0.1, 0.32],
    // 四色近景花保留明确的观察位置，其余花心按稳定 ID 布局。
    anchors: [
      [13.2, 43],
      [17.2, 46],
      [20.3, 41.5],
      [23.2, 47.5],
    ],
    petal: {
      length: 1.65,
      halfWidth: 0.52,
      rise: 0.5,
      cup: 0.19,
      layers: 3,
      layerScale: 0.2,
      layerHeight: 0.08,
    },
    petalCounts: [12, 10, 8],
    stemRadius: 0.025,
    centerRadius: 0.21,
    pollenRadius: 0.035,
    pollenCount: 9,
    footprint: 1.85,
    colors: [0xd98fa7, 0xf7e8d5, 0x82bfd2, 0xe3c680],
  },
  lily: {
    perFlower: 2,
    size: [0.7, 1.15],
    height: 0.075,
    notch: 0.18,
    edgeLift: 0.065,
    wave: 0.024,
    veins: 12,
    footprint: 1.06,
  },
  pearls: { samples: 24, sag: 1.65, radius: 0.085, threadRadius: 0.019 },
  wind: {
    speed: 0.75,
    secondarySpeed: 1.73,
    secondaryWeight: 0.28,
    treeAngle: 0.13,
    petalAngle: 0.025,
    lilyAngle: 0.014,
    // 二轴旋转后的保守世界空间包围余量；包括最大实例缩放。
    treeBounds: 0.55,
    petalBounds: 0.2,
    lilyBounds: 0.07,
  },
  water: { distortion: 0.00065, normalScale: 0.024, highlight: 0.85, caustic: 0.13 },
  material: {
    leaf: { roughness: 0.65, metalness: 0.16, bump: 0.018 },
    petal: { roughness: 0.63, metalness: 0.025, bump: 0.009 },
    lily: { color: 0x528775, roughness: 0.68, metalness: 0.025, bump: 0.016 },
  },
} as const);

interface GardenQuality {
  leavesPerTree: number;
  leafRows: number;
  petalRows: number;
  petalColumns: number;
  lilyRows: number;
  lilySegments: number;
  secondaryPetalStep: number;
  pearlStep: number;
  pearlSegments: number;
  pollenStep: number;
  crownShadow: boolean;
}

export const LAND_GARDEN_QUALITY: Readonly<Record<QualityTier, GardenQuality>> = Object.freeze({
  low: {
    leavesPerTree: 180,
    leafRows: 4,
    petalRows: 5,
    petalColumns: 4,
    lilyRows: 3,
    lilySegments: 24,
    secondaryPetalStep: 2,
    pearlStep: 2,
    pearlSegments: 6,
    pollenStep: 2,
    crownShadow: false,
  },
  medium: {
    leavesPerTree: 330,
    leafRows: 5,
    petalRows: 6,
    petalColumns: 4,
    lilyRows: 3,
    lilySegments: 28,
    secondaryPetalStep: 2,
    pearlStep: 2,
    pearlSegments: 6,
    pollenStep: 2,
    crownShadow: false,
  },
  high: {
    leavesPerTree: 480,
    leafRows: 6,
    petalRows: 10,
    petalColumns: 4,
    lilyRows: 4,
    lilySegments: 32,
    secondaryPetalStep: 1,
    pearlStep: 1,
    pearlSegments: 8,
    pollenStep: 1,
    crownShadow: true,
  },
  ultra: {
    leavesPerTree: 780,
    leafRows: 7,
    petalRows: 8,
    petalColumns: 6,
    lilyRows: 5,
    lilySegments: 40,
    secondaryPetalStep: 1,
    pearlStep: 1,
    pearlSegments: 8,
    pollenStep: 1,
    crownShadow: true,
  },
});
