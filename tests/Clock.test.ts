import { describe, expect, it } from 'vitest';
import { Clock } from '@/02-core';

describe('Clock（固定步长累加器）', () => {
  it('把真实时间切成等长逻辑步', () => {
    // 用整数步长，避免浮点累加边界让断言变脆弱。
    const clock = new Clock(10, 250);
    clock.advance(10);
    expect(clock.steps).toBe(1);
    expect(clock.alpha).toBe(0);
    clock.advance(35);
    expect(clock.steps).toBe(3);
    expect(clock.alpha).toBeCloseTo(0.5, 6);
  });

  it('不足一步时不推进逻辑，只累计插值进度', () => {
    const clock = new Clock(20, 250);
    clock.advance(5);
    expect(clock.steps).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.25, 5);
    clock.advance(15);
    expect(clock.steps).toBe(1);
  });

  it('切后台回来的超大 delta 被截断，不会一次补算上千步', () => {
    const clock = new Clock(10, 250);
    clock.advance(60_000);
    expect(clock.steps).toBe(25);
    expect(clock.elapsedMs).toBe(250);
  });

  it('负 delta 视为 0，elapsedMs 只增不减', () => {
    const clock = new Clock(10, 250);
    clock.advance(30);
    const before = clock.elapsedMs;
    clock.advance(-100);
    expect(clock.elapsedMs).toBe(before);
  });

  it('构造参数非法时明确抛错', () => {
    expect(() => new Clock(0, 250)).toThrow(RangeError);
    expect(() => new Clock(100, 50)).toThrow(RangeError);
  });

  it('reset() 清空全部状态', () => {
    const clock = new Clock(10, 250);
    clock.advance(100);
    clock.reset();
    expect(clock.steps).toBe(0);
    expect(clock.elapsedMs).toBe(0);
    expect(clock.alpha).toBe(0);
  });
});
