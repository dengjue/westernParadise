import { LAND_CRAFT, LAND_STRUCTURE } from './landCraft';

export interface LandBuilding {
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  height: number;
}

/** 生成与建筑完全相同的柱础位置；导航不再手抄一套主殿柱列。只在装配时分配。 */
export function buildingColumns(b: LandBuilding) {
  const c = LAND_STRUCTURE.columns;
  const count = b.width > 30 ? c.hallCount : c.pavilionCount;
  return [-1, 1].flatMap((side) =>
    Array.from({ length: count }, (_, i) => ({
      x: b.x + (i / (count - 1) - 0.5) * (b.width - c.insetX * 2),
      z: b.z + side * (b.depth / 2 - c.insetZ),
      radius: b.width * c.radiusRatio,
      side,
      index: i,
      count,
    })),
  );
}

export const LAND_PAVILIONS = [-1, 1].flatMap((side) =>
  LAND_STRUCTURE.pavilions.map((b) => ({ x: side * LAND_STRUCTURE.corridor.x, ...b })),
);
export const LAND_CORRIDOR_COLUMNS = [-1, 1].flatMap((side) => {
  const c = LAND_STRUCTURE.corridor;
  return Array.from({ length: c.bays }, (_, bay) =>
    [-1, 1].map((edge) => ({
      x: side * c.x + edge * c.columnOffset,
      z: c.startZ + bay * c.spacing,
      radius: c.columnRadius,
    })),
  ).flat();
});
export const LAND_COLUMN_BOUNDS = [
  ...buildingColumns(LAND_STRUCTURE.hall),
  ...LAND_PAVILIONS.flatMap(buildingColumns),
  ...LAND_CORRIDOR_COLUMNS,
].map((c) => ({ x: c.x, z: c.z, half: (c.radius * LAND_CRAFT.column.footWidthRatio) / 2 }));

export interface LandRail {
  from: readonly [number, number];
  to: readonly [number, number];
  base: number;
}
/** 可走区域栏杆的唯一坐标源，保留中轴、横桥与正殿阶道开口。 */
export const LAND_RAILINGS: readonly LandRail[] = [-1, 1].flatMap((side) => {
  const { terrace: t, stairs: s, hall: h } = LAND_STRUCTURE;
  return [
    { from: [side * 7, -18], to: [side * 7, 73], base: 1.3 },
    { from: [side * 9, 75], to: [side * 56, 75], base: 1.3 },
    { from: [side * 9, -19], to: [side * 56, -19], base: 1.3 },
    { from: [side * 57, -18], to: [side * 57, 73], base: 1.3 },
    { from: [side * 69, -75], to: [side * 69, 73], base: 1.3 },
    {
      from: [side * (t.halfWidth - 1), t.backZ + 3],
      to: [side * (t.halfWidth - 1), s.backZ - 0.5],
      base: h.base,
    },
    {
      from: [side * (s.width / 2 + 1), s.backZ - 0.5],
      to: [side * (t.halfWidth - 1), s.backZ - 0.5],
      base: h.base,
    },
  ] as LandRail[];
});
