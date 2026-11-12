import { describe, expect, it } from 'vitest';
import { WORLD } from '@/01-shared';
import { GridNavigator, runWalkTest, StaticColliders } from '@/07-systems';

describe('walktest 多层寻路', () => {
  it('配置路线均可穿过庭院、台基和侧向回廊', () => {
    const navigator = new GridNavigator({
      bounds: WORLD.bounds,
      cellSize: WORLD.navigation.cellSize,
      maxStepHeight: WORLD.navigation.maxStepHeight,
      maxSearchNodes: WORLD.navigation.maxSearchNodes,
      colliders: new StaticColliders({ obstacles: WORLD.collision.obstacles }),
    });
    const report = runWalkTest(navigator, WORLD.navigation.routes);

    expect(report.passed).toBe(true);
    expect(report.cases).toHaveLength(WORLD.navigation.routes.length);
    expect(report.cases.every((testCase) => testCase.path !== null)).toBe(true);

    const firstPath = report.cases[0]?.path;
    expect(firstPath?.points.some((point) => point.y === WORLD.ground.baseHeight)).toBe(true);
    expect(firstPath?.points.some((point) => point.y === WORLD.scene.platform.height)).toBe(true);
    expect(firstPath?.visitedNodes).toBeGreaterThan(0);
  });

  it('碰撞盒内的起点不会被寻路伪造为可通行', () => {
    const navigator = new GridNavigator({
      bounds: WORLD.bounds,
      cellSize: WORLD.navigation.cellSize,
      maxStepHeight: WORLD.navigation.maxStepHeight,
      maxSearchNodes: WORLD.navigation.maxSearchNodes,
      colliders: new StaticColliders({ obstacles: WORLD.collision.obstacles }),
    });

    expect(navigator.findPath({ x: 0, z: -13 }, { x: 0, z: 4 })).toBeNull();
    expect(navigator.findPath({ x: 100, z: 0 }, { x: 0, z: 4 })).toBeNull();
  });
});
