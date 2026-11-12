import type { GroundHeightArea, HorizontalAabb, WorldBounds } from '@/00-types';

/**
 * 庭院边界向内收缩半米：给角色胶囊半径和浮点误差留出安全余量，避免贴着围墙时
 * 因为边界与碰撞盒重合而出现穿墙抖动。这个推导只发生在配置层，逻辑层直接读结果。
 */
const WORLD_BOUNDS_MARGIN = 0.5 as const;
const COURTYARD = Object.freeze({
  width: 44,
  depth: 34,
} as const);

const PLATFORM = Object.freeze({
  minX: -8,
  maxX: 8,
  minZ: -14,
  maxZ: -7,
  height: 0.8,
} as const satisfies GroundHeightArea);

const BOUNDS = Object.freeze({
  minX: -COURTYARD.width / 2 + WORLD_BOUNDS_MARGIN,
  maxX: COURTYARD.width / 2 - WORLD_BOUNDS_MARGIN,
  minZ: -COURTYARD.depth / 2 + WORLD_BOUNDS_MARGIN,
  maxZ: COURTYARD.depth / 2 - WORLD_BOUNDS_MARGIN,
} as const satisfies WorldBounds);

const SPAWN = Object.freeze({
  x: 0,
  z: 14,
  yawDeg: 180,
} as const);

const CAPSULE = Object.freeze({
  radius: 0.35,
  height: 1.6,
} as const);

const PLAYER_VISUAL = Object.freeze({
  headRadius: 0.28,
  bodyColorHex: 0x5c6a6d,
  headColorHex: 0x8fa9a3,
  bodyRadialSegments: 8,
  bodyCapSegments: 4,
  headWidthSegments: 12,
  headHeightSegments: 8,
} as const);

const HALL = Object.freeze({
  width: 14,
  depth: 5,
  centerZ: -10.5,
  wallHeight: 3,
  wallThickness: 0.24,
  frontZ: -7.55,
  columnRadius: 0.26,
  columnHeight: 3.05,
  columnXs: Object.freeze([-5.5, -2.75, 0, 2.75, 5.5] as const),
  columnSegments: 8,
  columnBaseHeight: 0.16,
  columnBaseTopScale: 1.45,
  columnBaseBottomScale: 1.55,
  columnCapHeight: 0.16,
  columnCapTopScale: 1.28,
  columnCapBottomScale: 1.35,
  bracket: Object.freeze({
    layerHeight: 0.12,
    layerGap: 0.16,
    baseOffset: 0.18,
    lowerWidth: 0.8,
    lowerDepth: 0.42,
    middleWidth: 0.42,
    middleDepth: 0.72,
    upperWidth: 0.72,
    upperDepth: 0.42,
  } as const),
  beamHeight: 0.24,
  beamDepth: 0.28,
  beamFrontOffset: 0.04,
  beamBackOffset: 0.04,
  paperScreenWidth: 2.1,
  paperScreenHeight: 1.8,
  paperScreenThickness: 0.08,
  paperScreenInset: 0.06,
  paperScreenY: 1.8,
  signboard: Object.freeze({
    width: 4.8,
    height: 0.82,
    thickness: 0.12,
    y: 3.2,
    frontOffset: 0.22,
    inset: 0.08,
    faceOffset: 0.006,
  } as const),
  roofEave: 1.15,
  roofDepth: 6.6,
  roofRise: 1.65,
  roofThickness: 0.18,
  roofRidgeWidth: 0.5,
  roofRidgeHeight: 0.22,
  roofRidgeOffset: 0.08,
} as const);

const FIGURE = Object.freeze({
  pedestalTopRadius: 0.58,
  pedestalBottomRadius: 0.66,
  pedestalHeight: 0.24,
  pedestalSegments: 8,
  bodyRadius: 0.52,
  bodyHeight: 1.45,
  bodySegments: 8,
  headRadius: 0.37,
  headWidthSegments: 10,
  headHeightSegments: 6,
  headY: 1.9,
  accentRadius: 0.56,
  accentTube: 0.055,
  accentRadialSegments: 6,
  accentTubularSegments: 16,
  accentY: 1.94,
  accentZ: -0.02,
} as const);

const HALL_OBSTACLES: readonly HorizontalAabb[] = Object.freeze([
  Object.freeze({ minX: -7, maxX: 7, minZ: -13, maxZ: -12.7 }),
  Object.freeze({ minX: -7, maxX: -6.76, minZ: -13, maxZ: -8 }),
  Object.freeze({ minX: 6.76, maxX: 7, minZ: -13, maxZ: -8 }),
  ...HALL.columnXs.map((x) =>
    Object.freeze({
      minX: x - HALL.columnRadius,
      maxX: x + HALL.columnRadius,
      minZ: HALL.frontZ - HALL.columnRadius,
      maxZ: HALL.frontZ + HALL.columnRadius,
    }),
  ),
]);

const NAVIGATION = Object.freeze({
  cellSize: 1,
  maxStepHeight: 0.9,
  maxSearchNodes: 5000,
  routes: Object.freeze([
    Object.freeze({
      id: 'south-to-platform',
      start: Object.freeze({ x: SPAWN.x, z: SPAWN.z }),
      target: Object.freeze({ x: 0, z: -9 }),
    }),
    Object.freeze({
      id: 'platform-to-west-colonnade',
      start: Object.freeze({ x: 0, z: -9 }),
      target: Object.freeze({ x: -5, z: -7 }),
    }),
    Object.freeze({
      id: 'platform-to-garden',
      start: Object.freeze({ x: 0, z: -9 }),
      target: Object.freeze({ x: 3, z: 4 }),
    }),
    Object.freeze({
      id: 'garden-west-loop',
      start: Object.freeze({ x: 3, z: 4 }),
      target: Object.freeze({ x: -14, z: 4 }),
    }),
  ] as const),
} as const);

const SCENE = Object.freeze({
  wall: Object.freeze({
    height: 2.5,
    capHeight: 0.18,
    capWidth: 0.9,
    gateWidth: 8,
  } as const),
  platform: PLATFORM,
  paving: Object.freeze([
    Object.freeze({ minX: -14, maxX: 14, minZ: -4, maxZ: 12, y: 0.012 }),
    Object.freeze({ minX: -3.5, maxX: 3.5, minZ: -7, maxZ: 13, y: 0.02 }),
  ] as const),
  hall: HALL,
  hallObstacles: HALL_OBSTACLES,
  figure: FIGURE,
  figures: Object.freeze([
    Object.freeze({ x: -3, z: -11.7, scale: 0.96 }),
    Object.freeze({ x: 0, z: -11.7, scale: 1.08 }),
    Object.freeze({ x: 3, z: -11.7, scale: 0.92 }),
  ] as const),
  vegetation: Object.freeze([
    Object.freeze({ x: 15, z: 8, height: 4.4, radius: 1.35, kind: 'tree' as const }),
    Object.freeze({ x: 18, z: 11, height: 3.5, radius: 0.9, kind: 'bamboo' as const }),
    Object.freeze({ x: -16, z: 10, height: 3.8, radius: 1.1, kind: 'tree' as const }),
    Object.freeze({ x: 13, z: 13, height: 2.8, radius: 0.7, kind: 'bamboo' as const }),
  ] as const),
  vegetationShape: Object.freeze({
    tree: Object.freeze({
      trunkTopScale: 0.18,
      trunkBottomScale: 0.24,
      trunkHeightScale: 0.45,
      trunkSegments: 6,
      lowerCanopyHeightScale: 0.58,
      lowerCanopyYScale: 0.62,
      lowerCanopySegments: 7,
      upperCanopyRadiusScale: 0.72,
      upperCanopyHeightScale: 0.48,
      upperCanopyYScale: 0.86,
      upperCanopySegments: 7,
    } as const),
    bamboo: Object.freeze({
      stalkCount: 3,
      offsetScale: 0.55,
      heightBaseScale: 0.82,
      heightStepScale: 0.06,
      topRadiusScale: 0.12,
      bottomRadiusScale: 0.14,
      stalkSegments: 6,
      crownRadiusScale: 0.42,
      crownHeightScale: 0.3,
      crownYScale: 0.86,
      crownSegments: 6,
      crownZScale: 0.45,
    } as const),
  } as const),
  mountains: Object.freeze({
    count: 16,
    radius: 72,
    baseRadius: 11,
    minHeight: 8,
    maxHeight: 16,
    segments: 5,
    angleJitter: 0.08,
    distanceJitter: 3,
    radiusMinScale: 0.72,
    radiusMaxScale: 1.18,
    baseY: -0.4,
    seedSalt: 0x4d4f554e,
  } as const),
} as const);

/**
 * M1 的移动、相机与碰撞参数集中在这里，保证后续调手感只改配置，不把数值散落到
 * Character、FollowCamera 或碰撞求解逻辑中。当前只保留步行，不提前引入跑步参数。
 */
export const WORLD = Object.freeze({
  courtyard: COURTYARD,
  bounds: BOUNDS,
  spawn: SPAWN,
  player: Object.freeze({
    walkSpeed: 3.2,
    accelTime: 0.15,
    decelTime: 0.2,
    turnSpeed: 10,
    footstepDistance: 1.55,
    capsule: CAPSULE,
    visual: PLAYER_VISUAL,
  } as const),
  camera: Object.freeze({
    defaultDist: 4.5,
    minDist: 2.5,
    maxDist: 7,
    defaultYawDeg: 180,
    defaultPitchDeg: 18,
    lookSensitivityRadPerPixel: 0.003,
    zoomStep: 0.5,
    pitchMinDeg: -10,
    pitchMaxDeg: 55,
    lerp: 0.12,
  } as const),
  ground: Object.freeze({
    baseHeight: 0,
    heightAreas: Object.freeze([PLATFORM] as const),
  } as const),
  scene: SCENE,
  collision: Object.freeze({
    wallThickness: 0.5,
    obstacles: HALL_OBSTACLES,
  } as const),
  navigation: NAVIGATION,
  headHeight: 1.55,
} as const);
