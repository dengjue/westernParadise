import { describe, expect, it } from 'vitest';
import { MATERIALS, WORLD } from '@/01-shared';

describe('M1 庭院场景配置', () => {
  it('台基可视范围与角色地面采样使用同一组边界', () => {
    const platform = WORLD.scene.platform;
    const [heightArea] = WORLD.ground.heightAreas;

    expect(heightArea).toEqual(platform);
    expect(platform.height).toBeGreaterThan(WORLD.ground.baseHeight);
    expect(platform.minX).toBeLessThan(platform.maxX);
    expect(platform.minZ).toBeLessThan(platform.maxZ);
  });

  it('主殿、静态主体、侧植和远景均有可复现的最小配置', () => {
    expect(WORLD.scene.hall.width).toBeGreaterThan(0);
    expect(WORLD.scene.hall.depth).toBeGreaterThan(0);
    expect(WORLD.scene.hall.bracket.layerHeight).toBeGreaterThan(0);
    expect(WORLD.scene.hall.bracket.layerGap).toBeGreaterThan(WORLD.scene.hall.bracket.layerHeight);
    expect(WORLD.scene.figures).toHaveLength(3);
    expect(WORLD.scene.vegetation.length).toBeGreaterThanOrEqual(3);
    expect(WORLD.scene.mountains.count).toBeGreaterThanOrEqual(12);
    expect(WORLD.scene.hallObstacles.length).toBeGreaterThanOrEqual(8);

    for (const obstacle of WORLD.scene.hallObstacles) {
      expect(obstacle.minX).toBeLessThan(obstacle.maxX);
      expect(obstacle.minZ).toBeLessThan(obstacle.maxZ);
    }
  });

  it('材质参数与纹理尺寸全部冻结，避免启动后漂移', () => {
    expect(Object.isFrozen(MATERIALS)).toBe(true);
    expect(Object.isFrozen(MATERIALS.texture)).toBe(true);
    expect(MATERIALS.texture.width).toBeGreaterThan(0);
    expect(MATERIALS.texture.height).toBeGreaterThan(0);
    expect(MATERIALS.texture.cellsX).toBeGreaterThan(0);
    expect(MATERIALS.texture.cellsY).toBeGreaterThan(0);
  });
});
