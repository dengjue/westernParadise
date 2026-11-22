import { describe, expect, it } from 'vitest';
import { LAND_NAVIGATION, LAND_STOPS, landStopArrival } from '@/01-shared';
import { resolveLandNavigation, sampleLandHeight } from '@/02-core';

describe('resolveLandNavigation', () => {
  it('地面抵达与空中经过分开，离开阈值不随边界抖动', () => {
    expect(landStopArrival(4, false, false)).toBe('away');
    expect(landStopArrival(3, true, false)).toBe('overhead');
    expect(landStopArrival(3, false, true)).toBe('arrived');
    expect(landStopArrival(4.9, false, true)).toBe('arrived');
    expect(landStopArrival(5.1, false, true)).toBe('away');
  });
  it('每个可选目的地的中心都落在可步行面', () => {
    for (const {
      point: [x, z],
    } of LAND_STOPS)
      expect(sampleLandHeight(x, z, true)).not.toBeNull();
  });
  it('heading 以北为 0°，顺时针映射八方位并归一角度', () => {
    const north = resolveLandNavigation(0, 0, Math.PI);
    expect(north.headingDeg).toBeCloseTo(0, 8);
    expect(north.direction).toBe('北');

    const east = resolveLandNavigation(0, 0, Math.PI / 2);
    expect(east.headingDeg).toBeCloseTo(90, 8);
    expect(east.direction).toBe('东');

    const south = resolveLandNavigation(0, 0, 0);
    expect(south.headingDeg).toBeCloseTo(180, 8);
    expect(south.direction).toBe('南');

    const west = resolveLandNavigation(0, 0, -Math.PI / 2);
    expect(west.headingDeg).toBeCloseTo(270, 8);
    expect(west.direction).toBe('西');
  });

  it('选择平面最近区域与地标，距离不包含高度轴', () => {
    const lotus = LAND_NAVIGATION.landmarks.find(({ id }) => id === 'lotus-pond')!;
    const result = resolveLandNavigation(lotus.x + 3, lotus.z + 4, Math.PI);
    expect(result.area).toBe('莲池东庭');
    expect(result.landmark).toBe('七宝莲池');
    expect(result.distance).toBeCloseTo(5, 8);
  });

  it('按 -Z 为北的坐标约定标记南侧出生入口', () => {
    const southEntry = LAND_NAVIGATION.landmarks.find(({ id }) => id === 'south-entry')!;
    const result = resolveLandNavigation(0, 85, Math.PI);
    expect(southEntry.z).toBeGreaterThan(0);
    expect(result.landmark).toBe('南侧入口');
    expect(result.distance).toBeCloseTo(1, 8);
  });

  it('八方位边界采用最近方向的稳定分段', () => {
    const heading = (deg: number) => (Math.PI - (deg * Math.PI) / 180) % (Math.PI * 2);
    expect(resolveLandNavigation(0, 0, heading(22.4)).direction).toBe('北');
    expect(resolveLandNavigation(0, 0, heading(22.6)).direction).toBe('东北');
  });
});
