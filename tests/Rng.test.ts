import { describe, expect, it } from 'vitest';
import { Rng } from '@/02-core';

describe('Rng（mulberry32）', () => {
  it('同一种子产生完全一致的序列', () => {
    const a = new Rng(20261112);
    const b = new Rng(20261112);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() 落在 [0, 1)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int / range / pick 遵守边界', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.int(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(9);
      const float = rng.range(-2, 2);
      expect(float).toBeGreaterThanOrEqual(-2);
      expect(float).toBeLessThan(2);
    }
    expect(rng.pick([])).toBeUndefined();
    expect(rng.pick(['only'])).toBe('only');
  });

  it('reset() 后可重放同一序列', () => {
    const rng = new Rng(99);
    const first = Array.from({ length: 5 }, () => rng.next());
    rng.reset();
    const replay = Array.from({ length: 5 }, () => rng.next());
    expect(replay).toEqual(first);
  });
});
