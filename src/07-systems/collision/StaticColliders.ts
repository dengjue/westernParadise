import type { GroundHeightArea, HorizontalAabb, WorldBounds } from '@/00-types';
import { WORLD } from '@/01-shared';
import type { Vector3 } from 'three';

export interface StaticCollidersOptions {
  readonly bounds?: WorldBounds;
  readonly wallThickness?: number;
  readonly playerRadius?: number;
  readonly ground?: {
    readonly baseHeight: number;
    readonly heightAreas: readonly GroundHeightArea[];
  };
  /** 后续场景构建可注入建筑物碰撞盒；M1 默认只有庭院边界。 */
  readonly obstacles?: readonly HorizontalAabb[];
}

function copyBox(box: HorizontalAabb): HorizontalAabb {
  return Object.freeze({
    minX: box.minX,
    maxX: box.maxX,
    minZ: box.minZ,
    maxZ: box.maxZ,
  });
}

/**
 * 由玩家活动边界反推四面墙。
 *
 * `WORLD.bounds` 描述的是玩家圆心允许到达的范围，因此墙的内侧要额外向外退一个
 * 胶囊半径；这样圆形投影接触墙面时，圆心正好停在 bounds，而不是提前缩小活动区。
 */
function createBoundaryBoxes(
  bounds: WorldBounds,
  wallThickness: number,
  playerRadius: number,
): readonly HorizontalAabb[] {
  const innerWest = bounds.minX - playerRadius;
  const innerEast = bounds.maxX + playerRadius;
  const innerNorth = bounds.minZ - playerRadius;
  const innerSouth = bounds.maxZ + playerRadius;
  const outerWest = innerWest - wallThickness;
  const outerEast = innerEast + wallThickness;
  const outerNorth = innerNorth - wallThickness;
  const outerSouth = innerSouth + wallThickness;

  return Object.freeze([
    copyBox({ minX: outerWest, maxX: innerWest, minZ: outerNorth, maxZ: outerSouth }),
    copyBox({ minX: innerEast, maxX: outerEast, minZ: outerNorth, maxZ: outerSouth }),
    copyBox({ minX: innerWest, maxX: innerEast, minZ: outerNorth, maxZ: innerNorth }),
    copyBox({ minX: innerWest, maxX: innerEast, minZ: innerSouth, maxZ: outerSouth }),
  ]);
}

function intersectsCircle(
  centerX: number,
  centerZ: number,
  radius: number,
  box: HorizontalAabb,
): boolean {
  const closestX = Math.min(Math.max(centerX, box.minX), box.maxX);
  const closestZ = Math.min(Math.max(centerZ, box.minZ), box.maxZ);
  const distanceX = centerX - closestX;
  const distanceZ = centerZ - closestZ;
  // 接触本身允许，只有真正穿入 AABB 才回退，避免贴墙时每帧抖动。
  return distanceX * distanceX + distanceZ * distanceZ < radius * radius;
}

/**
 * M1 静态碰撞集合。
 *
 * 碰撞只看水平圆与 AABB 的投影，不引入物理引擎。一次移动先尝试完整位移；若完整
 * 位移穿入碰撞盒，再分别保留 x、保留 z 的结果，先 x 后 z，从而获得贴墙滑动效果。
 */
export class StaticColliders {
  readonly boxes: readonly HorizontalAabb[];

  private readonly playerRadius: number;
  private readonly baseGroundHeight: number;
  private readonly heightAreas: readonly GroundHeightArea[];

  constructor(options: StaticCollidersOptions = {}) {
    const bounds = options.bounds ?? WORLD.bounds;
    const wallThickness = options.wallThickness ?? WORLD.collision.wallThickness;
    this.playerRadius = options.playerRadius ?? WORLD.player.capsule.radius;
    const ground = options.ground ?? WORLD.ground;

    if (wallThickness < 0 || this.playerRadius < 0) {
      throw new RangeError('碰撞墙厚度和玩家半径不得为负数');
    }
    if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
      throw new RangeError('玩家活动边界必须具有正宽高');
    }

    const boundaries = createBoundaryBoxes(bounds, wallThickness, this.playerRadius);
    const obstacles = options.obstacles ?? [];
    const allBoxes: HorizontalAabb[] = [...boundaries];
    for (const obstacle of obstacles) {
      allBoxes.push(copyBox(obstacle));
    }
    this.boxes = Object.freeze(allBoxes);
    this.baseGroundHeight = ground.baseHeight;
    this.heightAreas = Object.freeze([...ground.heightAreas]);
  }

  /** 在 position 上应用一次水平位移；position 本身由调用方复用，方法不创建结果对象。 */
  moveCircle(position: Vector3, deltaX: number, deltaZ: number, radius = this.playerRadius): void {
    if (deltaX === 0 && deltaZ === 0) {
      return;
    }

    const startX = position.x;
    const startZ = position.z;
    const candidateX = startX + deltaX;
    const candidateZ = startZ + deltaZ;

    position.x = candidateX;
    position.z = candidateZ;
    if (!this.collides(candidateX, candidateZ, radius)) {
      return;
    }

    // 完整位移失败时先保留 x；若 x 也撞墙，再退回 x，随后单独尝试 z。
    position.x = candidateX;
    position.z = startZ;
    if (this.collides(position.x, position.z, radius)) {
      position.x = startX;
    }

    position.z = candidateZ;
    if (this.collides(position.x, position.z, radius)) {
      position.z = startZ;
    }
  }

  /** 按配置顺序采样地面；后声明且命中的区域覆盖前一个区域。 */
  sampleGroundHeight(x: number, z: number): number {
    let height = this.baseGroundHeight;
    for (const area of this.heightAreas) {
      if (x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ) {
        height = area.height;
      }
    }
    return height;
  }

  /** 只读占位查询，供寻路和 walktest 复用同一套玩家圆形碰撞口径。 */
  canOccupy(x: number, z: number, radius = this.playerRadius): boolean {
    return !this.collides(x, z, radius);
  }

  private collides(x: number, z: number, radius: number): boolean {
    for (const box of this.boxes) {
      if (intersectsCircle(x, z, radius, box)) {
        return true;
      }
    }
    return false;
  }
}
