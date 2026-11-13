import type { TimeOfDayId } from '@/00-types';
import { LAND_ATMOSPHERE, LAND_TIMES } from '@/01-shared';

/** 混合权重同时驱动光照和环境反射；重定向从当前值出发，不能跳回旧预设。 */
export class LandLightTransition {
  readonly weights = new Float32Array(3);
  private readonly from = new Float32Array(3);
  target: TimeOfDayId;
  active = false;
  private elapsed = 0;
  private index: number;

  constructor(
    initial: TimeOfDayId,
    private readonly reducedMotion: boolean,
  ) {
    this.target = initial;
    this.index = LAND_TIMES.indexOf(initial);
    this.weights[this.index] = 1;
  }

  request(id: TimeOfDayId): boolean {
    if (id === this.target) return false;
    this.target = id;
    this.index = LAND_TIMES.indexOf(id);
    this.from.set(this.weights);
    this.elapsed = 0;
    this.active = !this.reducedMotion;
    if (this.reducedMotion) {
      this.weights.fill(0);
      this.weights[this.index] = 1;
    }
    return true;
  }

  update(deltaMs: number): boolean {
    if (!this.active) return false;
    this.elapsed = Math.min(LAND_ATMOSPHERE.transitionMs, this.elapsed + Math.max(0, deltaMs));
    const t = this.elapsed / LAND_ATMOSPHERE.transitionMs;
    const eased = t * t * (3 - 2 * t);
    for (let i = 0; i < 3; i++)
      this.weights[i] = this.from[i]! * (1 - eased) + (i === this.index ? eased : 0);
    this.active = t < 1;
    return true;
  }
}
