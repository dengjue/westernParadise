import {
  LAND_COLUMN_BOUNDS,
  LAND_CRAFT,
  LAND_PAVILIONS,
  LAND_RAILINGS,
  LAND_STRUCTURE,
  PURE_LAND,
} from '@/01-shared';

/** 返回可走高度；柱础、格窗、墙、栏杆和侧亭地板与渲染共用数据。 */
export function sampleLandHeight(x: number, z: number): number | null {
  const { hall, stairs, navigation: nav, screens, backWall } = LAND_STRUCTURE;
  let height: number | null = null;
  for (const path of PURE_LAND.paths) {
    if (
      x >= path.minX + nav.pathInset &&
      x <= path.maxX - nav.pathInset &&
      z >= path.minZ + nav.pathInset &&
      z <= path.maxZ - nav.pathInset
    )
      height = path.height;
  }
  for (const b of LAND_PAVILIONS) {
    if (
      Math.abs(x - b.x) <= (b.width + 3) / 2 - nav.pathInset &&
      Math.abs(z - b.z) <= (b.depth + 3) / 2 - nav.pathInset
    )
      height = b.base;
  }
  if (height === LAND_STRUCTURE.courtHeight) height += LAND_CRAFT.floor.courtPavingRise;
  if (
    Math.abs(x - stairs.x) <= stairs.width / 2 - nav.bodyRadius &&
    z >= stairs.backZ - nav.pathInset &&
    z <= stairs.frontZ + nav.pathInset
  ) {
    const base = LAND_STRUCTURE.courtHeight + LAND_CRAFT.floor.courtPavingRise;
    height =
      base +
      Math.min(1, Math.max(0, (stairs.frontZ - z) / (stairs.frontZ - stairs.backZ))) *
        (hall.base - base);
  }
  if (height === null) return null;
  if (
    Math.abs(x - hall.x) < backWall.width / 2 + nav.bodyRadius &&
    Math.abs(z - hall.z - backWall.offsetZ) < backWall.depth / 2 + nav.bodyRadius
  )
    return null;
  if (
    Math.abs(Math.abs(x - hall.x) - screens.x) < screens.width / 2 + nav.bodyRadius &&
    Math.abs(z - (hall.z + hall.depth / 2 - screens.frontOffset)) <
      screens.depth / 2 + nav.bodyRadius
  )
    return null;
  for (const f of LAND_STRUCTURE.figures)
    if (Math.hypot(x - f.x, z - f.z) < nav.figureRadius * f.scale + nav.bodyRadius) return null;
  for (const c of LAND_COLUMN_BOUNDS)
    if (Math.abs(x - c.x) < c.half + nav.bodyRadius && Math.abs(z - c.z) < c.half + nav.bodyRadius)
      return null;
  for (const rail of LAND_RAILINGS) {
    const dx = rail.to[0] - rail.from[0],
      dz = rail.to[1] - rail.from[1];
    const t = Math.max(
      0,
      Math.min(1, ((x - rail.from[0]) * dx + (z - rail.from[1]) * dz) / (dx * dx + dz * dz)),
    );
    if (Math.hypot(x - rail.from[0] - t * dx, z - rail.from[1] - t * dz) < nav.bodyRadius + 0.23)
      return null;
  }
  return height;
}

/** 小步扫掠 + 分轴滑动；限制高差，不能从阶道侧面一步跃上台基。原地修改，无帧分配。 */
export function moveLandPosition(position: { x: number; z: number }, dx: number, dz: number): void {
  const nav = LAND_STRUCTURE.navigation;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / nav.sweepStep));
  const stepX = dx / count,
    stepZ = dz / count;
  for (let step = 0; step < count; step++) {
    let floor = sampleLandHeight(position.x, position.z);
    if (floor === null) return;
    const xFloor = sampleLandHeight(position.x + stepX, position.z);
    if (xFloor !== null && Math.abs(xFloor - floor) <= nav.maximumStep) {
      position.x += stepX;
      floor = xFloor;
    }
    const zFloor = sampleLandHeight(position.x, position.z + stepZ);
    if (zFloor !== null && Math.abs(zFloor - floor) <= nav.maximumStep) position.z += stepZ;
  }
}
