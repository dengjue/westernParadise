import type { WorldBounds } from '@/00-types';

/**
 * 庭院边界向内收缩半米：给角色胶囊半径和浮点误差留出安全余量，避免贴着围墙时
 * 因为边界与碰撞盒重合而出现穿墙抖动。这个推导只发生在配置层，逻辑层直接读结果。
 */
const WORLD_BOUNDS_MARGIN = 0.5 as const;
const COURTYARD = Object.freeze({
  width: 44,
  depth: 34,
} as const);

const BOUNDS = Object.freeze({
  minX: -COURTYARD.width / 2 + WORLD_BOUNDS_MARGIN,
  maxX: COURTYARD.width / 2 - WORLD_BOUNDS_MARGIN,
  minZ: -COURTYARD.depth / 2 + WORLD_BOUNDS_MARGIN,
  maxZ: COURTYARD.depth / 2 - WORLD_BOUNDS_MARGIN,
} as const satisfies WorldBounds);

const CAPSULE = Object.freeze({
  radius: 0.35,
  height: 1.6,
} as const);

/**
 * M1 的移动、相机与碰撞参数集中在这里，保证后续调手感只改配置，不把数值散落到
 * Character、FollowCamera 或碰撞求解逻辑中。当前只保留步行，不提前引入跑步参数。
 */
export const WORLD = Object.freeze({
  courtyard: COURTYARD,
  bounds: BOUNDS,
  spawn: Object.freeze({
    x: 0,
    z: 14,
    yawDeg: 180,
  } as const),
  player: Object.freeze({
    walkSpeed: 3.2,
    accelTime: 0.15,
    decelTime: 0.2,
    turnSpeed: 10,
    capsule: CAPSULE,
  } as const),
  camera: Object.freeze({
    defaultDist: 4.5,
    minDist: 2.5,
    maxDist: 7,
    pitchMinDeg: -10,
    pitchMaxDeg: 55,
    lerp: 0.12,
  } as const),
  headHeight: 1.55,
} as const);
