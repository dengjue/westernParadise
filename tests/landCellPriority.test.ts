import { describe, expect, it } from 'vitest';
import { prioritizeLandCells } from '@/02-core';
import type { LandCellCandidate, LandCellPriorityOptions } from '@/02-core';

const OPTIONS: LandCellPriorityOptions = {
  activeRadius: 64,
  prefetchRadius: 160,
  minimumForwardDot: -0.2,
  frontBias: 24,
  maxCells: 16,
};

const CAMERA = { x: 0, z: 0, forwardX: 0, forwardZ: -1 } as const;

describe('分区加载阶段 4 · cell 需求优先级规划', () => {
  it('近区无论在相机前后都保持 active，且前方远区进入预取带', () => {
    const cells: LandCellCandidate[] = [
      { key: 'behind-near', centerX: 0, centerZ: 48 },
      { key: 'ahead-near', centerX: 0, centerZ: -48 },
      { key: 'ahead-far', centerX: 0, centerZ: -120 },
      { key: 'outside', centerX: 0, centerZ: -192 },
      { key: 'behind-far', centerX: 0, centerZ: 120 },
    ];
    expect(
      prioritizeLandCells(cells, CAMERA, OPTIONS).map(({ key, intent }) => [key, intent]),
    ).toEqual([
      ['ahead-near', 'active'],
      ['behind-near', 'active'],
      ['ahead-far', 'prefetch'],
    ]);
  });

  it('同距离预取优先视线前方；侧后方按扇区点积过滤', () => {
    const cells: LandCellCandidate[] = [
      { key: 'side', centerX: 120, centerZ: 0 },
      { key: 'ahead', centerX: 0, centerZ: -120 },
      { key: 'behind', centerX: 0, centerZ: 120 },
    ];
    const plan = prioritizeLandCells(cells, CAMERA, OPTIONS);
    expect(plan.map(({ key }) => key)).toEqual(['ahead', 'side']);
    expect(plan[0]?.priority).toBeLessThan(plan[1]?.priority ?? Infinity);
  });

  it('硬限制候选数量，并让输出不受输入顺序影响', () => {
    const cells: LandCellCandidate[] = [
      { key: 'd', centerX: 48, centerZ: 0 },
      { key: 'b', centerX: 24, centerZ: 0 },
      { key: 'a', centerX: 24, centerZ: 0 },
      { key: 'c', centerX: 48, centerZ: 0 },
    ];
    const limited = prioritizeLandCells(cells, CAMERA, { ...OPTIONS, maxCells: 2 });
    const reversed = prioritizeLandCells([...cells].reverse(), CAMERA, {
      ...OPTIONS,
      maxCells: 2,
    });
    expect(limited.map(({ key }) => key)).toEqual(['a', 'b']);
    expect(reversed.map(({ key }) => key)).toEqual(['a', 'b']);
  });

  it('无效候选被忽略，无效朝向返回空计划', () => {
    const plan = prioritizeLandCells(
      [
        { key: 'valid', centerX: 0, centerZ: -48 },
        { key: '', centerX: 0, centerZ: -24 },
        { key: 'nan', centerX: Number.NaN, centerZ: 0 },
      ],
      CAMERA,
      OPTIONS,
    );
    expect(plan.map(({ key }) => key)).toEqual(['valid']);
    expect(prioritizeLandCells([], { ...CAMERA, forwardX: 0, forwardZ: 0 }, OPTIONS)).toEqual([]);
  });

  it('拒绝会破坏范围或预算上限的配置', () => {
    expect(() =>
      prioritizeLandCells([], CAMERA, { ...OPTIONS, prefetchRadius: OPTIONS.activeRadius - 1 }),
    ).toThrow(RangeError);
    expect(() => prioritizeLandCells([], CAMERA, { ...OPTIONS, maxCells: 0 })).toThrow(RangeError);
  });
});
