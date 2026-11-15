import { LAND_REGION_SURFACE_HEIGHT, LAND_STRUCTURE, LAND_WORLD } from '@/01-shared';

export type LandRegion = (typeof LAND_WORLD.regions)[number];

/**
 * 用左闭右开的分区边界定位区域，避免玩家站在公共边界时两个区域同时命中；
 * 全图最外沿只在最大坐标处闭合，便于调试取样，不改变移动碰撞的内缩边界。
 */
export function resolveLandRegion(x: number, z: number): LandRegion | null {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    x < LAND_WORLD.bounds.minX ||
    x > LAND_WORLD.bounds.maxX ||
    z < LAND_WORLD.bounds.minZ ||
    z > LAND_WORLD.bounds.maxZ
  )
    return null;
  return (
    LAND_WORLD.regions.find(({ bounds }) => {
      const withinX =
        x >= bounds.minX &&
        (x < bounds.maxX || (bounds.maxX === LAND_WORLD.bounds.maxX && x === bounds.maxX));
      const withinZ =
        z >= bounds.minZ &&
        (z < bounds.maxZ || (bounds.maxZ === LAND_WORLD.bounds.maxZ && z === bounds.maxZ));
      return withinX && withinZ;
    }) ?? null
  );
}

/** 米制坐标映射到以全图西北角为原点的稳定网格索引；边界外返回 null。 */
export function landCellCoordinates(
  x: number,
  z: number,
): { readonly column: number; readonly row: number } | null {
  if (!resolveLandRegion(x, z)) return null;
  return {
    column: Math.floor((x - LAND_WORLD.cellOrigin.x) / LAND_WORLD.cellSize),
    row: Math.floor((z - LAND_WORLD.cellOrigin.z) / LAND_WORLD.cellSize),
  };
}

/** 按稳定 region seedKey 派生区域种子；不依赖运行时字符串 hash 或随机数实现。 */
export function resolveLandRegionSeed(worldSeed: number, regionId: string): number | null {
  if (!Number.isFinite(worldSeed)) return null;
  const region = LAND_WORLD.regions.find(({ id }) => id === regionId);
  if (!region) return null;
  let hash = (0x811c9dc5 ^ (worldSeed >>> 0)) >>> 0;
  for (let index = 0; index < region.seedKey.length; index++) {
    hash = Math.imul(hash ^ region.seedKey.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * 东侧灰盒区步行高度。水面不提供落脚点；跨池桥面和核心区主路使用统一高度源。
 */
export function sampleEastPrototypeHeight(x: number, z: number): number | null {
  const bodyRadius = LAND_STRUCTURE.navigation.bodyRadius;
  const { east } = LAND_WORLD.prototype;
  const route = east.route;
  if (
    x >= route.minX + bodyRadius &&
    x <= route.maxX - bodyRadius &&
    z >= route.minZ + bodyRadius &&
    z <= route.maxZ - bodyRadius
  )
    return LAND_REGION_SURFACE_HEIGHT;

  const region = resolveLandRegion(x, z);
  if (region?.id !== 'east-water-court') return null;
  const { bounds } = region;
  const { boundary, landmark } = east;
  if (
    x < bounds.minX + bodyRadius ||
    x > bounds.maxX - boundary.thickness - bodyRadius ||
    z < bounds.minZ + boundary.thickness + bodyRadius ||
    z > bounds.maxZ - boundary.thickness - bodyRadius
  )
    return null;

  const { pond } = east;
  const bridge = pond.bridge;
  const bridgeHalfWidth = bridge.width / 2 - bodyRadius;
  const onBridge =
    Math.abs(x - bridge.centerX) <= bridgeHalfWidth &&
    z >= bridge.minZ + bodyRadius &&
    z <= bridge.maxZ - bodyRadius;
  if (onBridge) {
    for (const side of [-1, 1] as const) {
      const railX = bridge.centerX + side * (bridge.width / 2 - 0.18);
      if (Math.abs(x - railX) < bodyRadius + 0.12) return null;
    }
    return LAND_REGION_SURFACE_HEIGHT + bridge.rise;
  }

  if (Math.hypot(x - pond.x, z - pond.z) <= pond.radius + bodyRadius) return null;
  const pillarHalfSize = landmark.pillarSize / 2 + bodyRadius;
  for (const xSide of [-1, 1] as const)
    for (const zSide of [-1, 1] as const)
      if (
        Math.abs(x - (landmark.x + (xSide * landmark.span) / 2)) < pillarHalfSize &&
        Math.abs(z - (landmark.z + (zSide * landmark.span) / 2)) < pillarHalfSize
      )
        return null;
  return LAND_REGION_SURFACE_HEIGHT;
}
