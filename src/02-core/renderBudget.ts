import { LAND_RENDER } from '@/01-shared';

/** 首次直接选级；以后跨过不同进/出阈值才切换，镜头微抖不会反复重建细节。 */
export function distanceLevel(
  distance: number,
  previous: number,
  thresholds: readonly number[],
  hysteresis: number,
  minimum = 0,
): number {
  let level = previous < 0 ? 0 : previous;
  if (previous < 0) {
    while (level < thresholds.length && distance >= thresholds[level]!) level++;
  } else {
    while (level < thresholds.length && distance > thresholds[level]! + hysteresis) level++;
    while (level > 0 && distance < thresholds[level - 1]! - hysteresis) level--;
  }
  return Math.max(minimum, level);
}

/** 缓存的是拍摄时的投影与纹理，只有相机完全稳定才允许跳过反射绘制。 */
export class ReflectionSchedule {
  private readonly world = new Float64Array(16);
  private readonly projection = new Float64Array(16);
  private dirty = true;
  private last = -Infinity;

  constructor(
    private readonly intervalMs: number,
    private readonly reducedMotion: boolean,
  ) {}

  invalidate(): void {
    this.dirty = true;
  }

  needsUpdate(now: number, world: ArrayLike<number>, projection: ArrayLike<number>): boolean {
    if (this.dirty) return true;
    for (let i = 0; i < 16; i++) {
      if (
        Math.abs(this.world[i]! - world[i]!) > LAND_RENDER.reflection.matrixTolerance ||
        Math.abs(this.projection[i]! - projection[i]!) > LAND_RENDER.reflection.matrixTolerance
      )
        return true;
    }
    return !this.reducedMotion && now - this.last >= this.intervalMs;
  }

  rendered(now: number, world: ArrayLike<number>, projection: ArrayLike<number>): void {
    for (let i = 0; i < 16; i++) {
      this.world[i] = world[i]!;
      this.projection[i] = projection[i]!;
    }
    this.last = now;
    this.dirty = false;
  }
}

/** 以真实帧间隔累计持续超预算区间；长暂停不触发降级，手动画质永久锁定。 */
export class AdaptiveRenderBudget {
  scale = 1;
  private slow = 0;
  private fast = 0;
  private cooldown = 0;

  constructor(readonly locked: boolean) {}

  update(deltaMs: number): boolean {
    const config = LAND_RENDER.adaptive;
    if (this.locked || deltaMs <= 0 || deltaMs > config.ignoreOverMs) {
      this.slow = this.fast = 0;
      return false;
    }
    this.cooldown = Math.max(0, this.cooldown - deltaMs);
    this.slow = deltaMs > config.slowMs ? this.slow + deltaMs : 0;
    this.fast = deltaMs < config.fastMs ? this.fast + deltaMs : 0;
    if (this.cooldown > 0) return false;
    const before = this.scale;
    const units = 1 / config.step;
    if (this.slow >= config.lowerAfterMs)
      this.scale = Math.max(config.minimum, Math.round((this.scale - config.step) * units) / units);
    else if (this.fast >= config.raiseAfterMs)
      this.scale = Math.min(1, Math.round((this.scale + config.step) * units) / units);
    if (before === this.scale) return false;
    this.cooldown = config.cooldownMs;
    this.slow = this.fast = 0;
    return true;
  }
}
