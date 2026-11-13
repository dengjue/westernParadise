import { describe, expect, it } from 'vitest';
import { sampleLandHeight } from '@/07-systems';
import { moveLandPosition } from '@/02-core';
import { LAND_COLUMN_BOUNDS } from '@/01-shared';

describe('极乐世界实际步行空间', () => {
  it('入口到正殿中轴连续可走，阶道高度逐步增加', () => {
    let previous = 1.2;
    for (let z = 85; z >= -47; z -= 0.25) {
      const height = sampleLandHeight(0, z);
      expect(height, `中轴 z=${z} 应可达`).not.toBeNull();
      expect(Math.abs(height! - previous)).toBeLessThan(0.12);
      previous = height!;
    }
  });
  it('禁止进入莲池、莲台和正殿实体柱', () => {
    expect(sampleLandHeight(20, 30)).toBeNull();
    expect(sampleLandHeight(0, -55)).toBeNull();
    expect(sampleLandHeight(4, -38.3)).toBeNull();
    expect(sampleLandHeight(0, -62.8)).toBeNull();
    expect(sampleLandHeight(0, -70)).toBe(3.2);
  });
  it('两侧回廊通过前庭和池端与中轴连通', () => {
    for (const side of [-1, 1]) {
      for (let x = 0; x <= 64.5; x += 0.5) expect(sampleLandHeight(x * side, 82)).not.toBeNull();
      for (let z = 82; z >= -26; z -= 0.25) expect(sampleLandHeight(side * 64.5, z)).not.toBeNull();
      for (let x = 0; x <= 64.5; x += 0.5) expect(sampleLandHeight(x * side, -21)).not.toBeNull();
    }
  });
  it('所有开放建筑柱础、格窗与栏杆拦截身体，侧亭地板使用实际高度', () => {
    for (const c of LAND_COLUMN_BOUNDS) expect(sampleLandHeight(c.x, c.z)).toBeNull();
    expect(sampleLandHeight(16.2, -38.1)).toBeNull();
    expect(sampleLandHeight(57, 50)).toBeNull();
    expect(sampleLandHeight(64.5, 50)).toBe(1.5);
  });
  it('长位移不能穿柱、穿栏或从侧面跃上台阶；能沿边缘滑动', () => {
    const p = { x: 4, z: -34 };
    moveLandPosition(p, 0, -10);
    expect(p.z).toBeGreaterThan(-38);
    const stair = { x: 12, z: -30 };
    moveLandPosition(stair, -7, 0);
    expect(stair.x).toBeGreaterThan(8);
    const rail = { x: 5.5, z: 50 };
    moveLandPosition(rail, 5, -3);
    expect(rail.x).toBeLessThan(6.4);
    expect(rail.z).toBeCloseTo(47);
  });
  it('真实推进覆盖中轴、两侧亭廊和横桥，往返高度连续且到达终点', () => {
    const points = [
      [0, -44],
      [0, -21],
      [64.5, -21],
      [64.5, 82],
      [0, 82],
      [-64.5, 82],
      [-64.5, -21],
      [0, -21],
      [0, 85],
    ];
    const p = { x: 0, z: 85 };
    for (const [x, z] of points) {
      for (let n = 0; n < 2000 && Math.hypot(p.x - x!, p.z - z!) > 0.05; n++) {
        const distance = Math.hypot(x! - p.x, z! - p.z);
        const step = Math.min(0.1, distance) / distance;
        const before = sampleLandHeight(p.x, p.z)!;
        moveLandPosition(p, (x! - p.x) * step, (z! - p.z) * step);
        expect(Math.abs(sampleLandHeight(p.x, p.z)! - before)).toBeLessThanOrEqual(0.35);
      }
      expect(Math.hypot(p.x - x!, p.z - z!), `未到达 ${x},${z}`).toBeLessThan(0.05);
    }
  });
});
