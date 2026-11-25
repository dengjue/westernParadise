import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { LAND_REGION_SURFACE_HEIGHT, LAND_WORLD } from '@/01-shared';
import {
  landCellCoordinates,
  moveLandPosition,
  resolveLandNavigation,
  resolveLandRegion,
  resolveLandRegionSeed,
  sampleEastPrototypeHeight,
  sampleLandHeight,
} from '@/02-core';
import type { PureLandMaterials } from '@/05-materials';
import { createEastRegionPrototype } from '@/06-world/land/RegionPrototype';

describe('大世界区域契约与阶段 3 东侧灰盒', () => {
  it('9 区按唯一左闭右开边界稳定定位，世界外返回空', () => {
    expect(LAND_WORLD.regions).toHaveLength(9);
    expect(resolveLandRegion(0, 0)?.id).toBe('core-court');
    expect(resolveLandRegion(120, 83)?.id).toBe('east-water-court');
    expect(resolveLandRegion(-120, 0)?.id).toBe('core-court');
    expect(resolveLandRegion(360, 360)?.id).toBe('southeast-garden');
    expect(resolveLandRegion(360.01, 0)).toBeNull();
    expect(resolveLandRegion(Number.NaN, 0)).toBeNull();
  });

  it('所有门户两侧均登记邻接关系且门户落在全图网格边界', () => {
    for (const portal of LAND_WORLD.portals) {
      const from = LAND_WORLD.regions.find(({ id }) => id === portal.from)!;
      const to = LAND_WORLD.regions.find(({ id }) => id === portal.to)!;
      expect(from.neighbors).toContain(to.id);
      expect(to.neighbors).toContain(from.id);
      expect([from.id, to.id]).toContain(resolveLandRegion(portal.x, portal.z)?.id);
    }
    expect(LAND_WORLD.portals).toHaveLength(12);
  });

  it('网格原点把 240m 分区精确分成 5×5 个 48m cell', () => {
    expect(landCellCoordinates(-360, -360)).toEqual({ column: 0, row: 0 });
    expect(landCellCoordinates(119.99, 119.99)).toEqual({ column: 9, row: 9 });
    expect(landCellCoordinates(120, -120)).toEqual({ column: 10, row: 5 });
    expect(landCellCoordinates(359.99, 119.99)).toEqual({ column: 14, row: 9 });
    expect(landCellCoordinates(360.01, 0)).toBeNull();
  });

  it('区域 seed 对同一世界种子可复现、跨区域与跨世界种子有区分', () => {
    const north = resolveLandRegionSeed(309, 'north-grove');
    expect(north).not.toBeNull();
    expect(resolveLandRegionSeed(309, 'north-grove')).toBe(north);
    expect(resolveLandRegionSeed(309, 'east-water-court')).not.toBe(north);
    expect(resolveLandRegionSeed(310, 'north-grove')).not.toBe(north);
    expect(resolveLandRegionSeed(309, 'unknown')).toBeNull();
    expect(resolveLandRegionSeed(Number.NaN, 'north-grove')).toBeNull();
  });

  it('第三人称东行路线连续，第一人称仍受原场景边界约束', () => {
    expect(sampleLandHeight(200, 83)).toBeNull();
    expect(sampleLandHeight(200, 83, true)).toBe(LAND_REGION_SURFACE_HEIGHT);
    const position = { x: 0, z: 83 };
    moveLandPosition(position, 200, 0, true);
    expect(position.x).toBeCloseTo(200, 2);
    expect(position.z).toBeCloseTo(83, 2);
    expect(sampleLandHeight(position.x, position.z, true)).toBe(LAND_REGION_SURFACE_HEIGHT);
  });

  it('水面不可步行，桥面连通且护栏/观景台柱阻挡角色', () => {
    const { east } = LAND_WORLD.prototype;
    const { pond, landmark } = east;
    expect(sampleEastPrototypeHeight(pond.x + pond.radius, pond.z)).toBeNull();
    expect(sampleEastPrototypeHeight(pond.bridge.centerX, pond.z)).toBeCloseTo(
      LAND_REGION_SURFACE_HEIGHT + pond.bridge.rise,
    );
    expect(sampleEastPrototypeHeight(pond.bridge.centerX, pond.bridge.maxZ + 1)).toBe(
      LAND_REGION_SURFACE_HEIGHT,
    );
    expect(sampleEastPrototypeHeight(pond.bridge.centerX, east.route.minZ + 1)).toBe(
      LAND_REGION_SURFACE_HEIGHT,
    );
    expect(
      sampleEastPrototypeHeight(pond.bridge.centerX + pond.bridge.width / 2 - 0.18, 16),
    ).toBeNull();
    expect(
      sampleEastPrototypeHeight(landmark.x + landmark.span / 2, landmark.z + landmark.span / 2),
    ).toBeNull();
  });

  it('HUD 在新区域使用区域边界标签与对应地标', () => {
    const { landmark } = LAND_WORLD.prototype.east;
    const info = resolveLandNavigation(landmark.x, landmark.z, Math.PI);
    expect(info.area).toBe('东侧水院');
    expect(info.landmark).toBe('水院观景台');
  });

  it.each([24, 48])('%d 米灰盒东区地面按稳定 cell 网格铺设', (cellSize) => {
    const ownedMaterials = Array.from({ length: 8 }, () => new MeshStandardMaterial());
    const materials = {
      stone: ownedMaterials[0]!,
      carvedStone: ownedMaterials[1]!,
      dark: ownedMaterials[2]!,
      jade: ownedMaterials[3]!,
      goldDark: ownedMaterials[4]!,
      gold: ownedMaterials[5]!,
      wood: ownedMaterials[6]!,
      leaf: ownedMaterials[7]!,
    } as unknown as PureLandMaterials;
    const root = new Group();
    const dispose = createEastRegionPrototype(root, materials, cellSize);
    const regionRoot = root.getObjectByName('region-prototype-east-water-court') as Group;
    const groundCells: Mesh[] = [];
    regionRoot.traverse((child) => {
      if (
        child instanceof Mesh &&
        child.name === 'land-static-batch' &&
        child.userData['cell'] !== undefined &&
        child.material === materials.dark
      )
        groundCells.push(child);
    });
    expect(groundCells).toHaveLength((LAND_WORLD.regionSize / cellSize) ** 2);
    expect(regionRoot.userData['cellSize']).toBe(cellSize);
    expect(regionRoot.children).toHaveLength((LAND_WORLD.regionSize / cellSize) ** 2);
    expect(regionRoot.getObjectByName('region-prototype-east-pond')).toBeDefined();
    expect(regionRoot.getObjectByName('region-prototype-east-pond-shore')).toBeDefined();

    dispose();
    for (const material of ownedMaterials) material.dispose();
  });
});
