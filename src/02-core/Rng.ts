/**
 * mulberry32 伪随机数发生器。
 *
 * 为什么不用 Math.random()：验收要求「?seed= 固定种子可复现问题」，
 * 而场景生成、粒子分布、天气抖动都会用到随机数。Math.random 无法复现，
 * 会让 bug 报告失去价值。本实现只有 32 位状态、无外部依赖、同种子逐位确定。
 *
 * 注意它是 PRNG，不用于任何安全/加密场景。
 */
export class Rng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** 返回 [0, 1) 区间浮点数。 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max) 区间浮点数。 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 返回 [minInclusive, maxExclusive) 区间整数。 */
  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.range(minInclusive, maxExclusive));
  }

  /** 从只读数组取一项；空数组返回 undefined（配合 noUncheckedIndexedAccess 安全使用）。 */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) {
      return undefined;
    }
    return items[this.int(0, items.length)];
  }

  /** 复位到初始种子，便于在同一实例上重放。 */
  reset(): void {
    this.state = this.seed;
  }
}
