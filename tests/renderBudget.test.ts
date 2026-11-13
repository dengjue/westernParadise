import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { AdaptiveRenderBudget, distanceLevel, ReflectionSchedule } from '@/02-core';
import { LAND_RENDER } from '@/01-shared';

describe('距离分级与反射调度', () => {
  it('可直接跨两级，进出阈值不同，反射最低等级不能被近距离突破', () => {
    const select = (distance: number, previous: number, minimum = 0) =>
      distanceLevel(distance, previous, [40, 90], 6, minimum);
    expect(select(80, -1)).toBe(1);
    expect(select(44, 0)).toBe(0);
    expect(select(47, 0)).toBe(1);
    expect(select(35, 1)).toBe(1);
    expect(select(33, 1)).toBe(0);
    expect(select(200, 0)).toBe(2);
    expect(select(2, 2)).toBe(0);
    expect(select(2, 2, 1)).toBe(1);
  });

  it('相机移动/投影/显式失效立即刷新，静止受频率限制，记录时复制矩阵', () => {
    const schedule = new ReflectionSchedule(50, false);
    const world = new Matrix4(),
      projection = new Matrix4();
    expect(schedule.needsUpdate(0, world.elements, projection.elements)).toBe(true);
    schedule.rendered(0, world.elements, projection.elements);
    expect(schedule.needsUpdate(49, world.elements, projection.elements)).toBe(false);
    expect(schedule.needsUpdate(50, world.elements, projection.elements)).toBe(true);
    world.elements[12] = 0.1;
    expect(schedule.needsUpdate(1, world.elements, projection.elements)).toBe(true);
    schedule.rendered(1, world.elements, projection.elements);
    projection.elements[0] = 2;
    expect(schedule.needsUpdate(2, world.elements, projection.elements)).toBe(true);
    schedule.rendered(2, world.elements, projection.elements);
    schedule.invalidate();
    expect(schedule.needsUpdate(3, world.elements, projection.elements)).toBe(true);
  });

  it('减动效仅因失效刷新；小于容差的浮点抖动不重拍，累计位移仍会失效', () => {
    const schedule = new ReflectionSchedule(50, true),
      matrix = new Matrix4();
    schedule.rendered(0, matrix.elements, matrix.elements);
    expect(schedule.needsUpdate(60000, matrix.elements, matrix.elements)).toBe(false);
    matrix.elements[12] = LAND_RENDER.reflection.matrixTolerance / 2;
    expect(schedule.needsUpdate(60001, matrix.elements, matrix.elements)).toBe(false);
    matrix.elements[12] *= 3;
    expect(schedule.needsUpdate(60002, matrix.elements, matrix.elements)).toBe(true);
  });
});

describe('自动像素预算', () => {
  it('手动锁定永不改变；偶发慢帧和长暂停不积累降档', () => {
    const locked = new AdaptiveRenderBudget(true),
      automatic = new AdaptiveRenderBudget(false);
    for (let i = 0; i < 500; i++) {
      expect(locked.update(40)).toBe(false);
      automatic.update(40);
      automatic.update(16);
    }
    expect(locked.scale).toBe(1);
    for (let i = 0; i < 50; i++) automatic.update(40);
    automatic.update(1000);
    for (let i = 0; i < 50; i++) automatic.update(40);
    expect(automatic.scale).toBe(1);
  });

  it('持续慢帧分步降档，冷却期不呼吸，持续快帧缓慢恢复且上下限封闭', () => {
    const budget = new AdaptiveRenderBudget(false),
      changes: number[] = [];
    for (let i = 0; i < 59; i++) expect(budget.update(40)).toBe(false);
    expect(budget.update(40)).toBe(true);
    expect(budget.scale).toBeCloseTo(0.9);
    for (let i = 0; i < 149; i++) expect(budget.update(40)).toBe(false);
    expect(budget.update(40)).toBe(true);
    for (let i = 0; i < 1000; i++) if (budget.update(40)) changes.push(budget.scale);
    expect(budget.scale).toBe(LAND_RENDER.adaptive.minimum);
    expect(changes.length).toBeLessThanOrEqual(2);
    for (let i = 0; i < 624; i++) expect(budget.update(16)).toBe(false);
    expect(budget.update(16)).toBe(true);
    expect(budget.scale).toBeCloseTo(0.8);
    for (let i = 0; i < 3000; i++) budget.update(16);
    expect(budget.scale).toBe(1);
  });
});
