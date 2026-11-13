import { describe, expect, it } from 'vitest';
import { sampleLandHeight } from '@/07-systems';

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
    expect(sampleLandHeight(0, -70)).toBeNull();
  });
  it('两侧回廊通过前庭和池端与中轴连通', () => {
    for (const side of [-1, 1]) {
      for (let x = 0; x <= 63; x++) expect(sampleLandHeight(x * side, 82)).not.toBeNull();
      for (let z = 82; z >= -26; z--) expect(sampleLandHeight(side * 63, z)).not.toBeNull();
      for (let x = 0; x <= 63; x++) expect(sampleLandHeight(x * side, -26)).not.toBeNull();
    }
  });
});
