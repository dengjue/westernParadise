import { describe, expect, it, vi } from 'vitest';
import { Box3, Group, Mesh, MeshStandardMaterial } from 'three';
import { LAND_REGION_SURFACE_HEIGHT, LAND_WORLD } from '@/01-shared';
import type { PureLandMaterials } from '@/05-materials';
import { createEastRegionCellPayload } from '@/06-world/land/RegionPrototype';

function createMaterials(): {
  materials: PureLandMaterials;
  owned: MeshStandardMaterial[];
} {
  const owned = Array.from({ length: 8 }, () => new MeshStandardMaterial());
  return {
    materials: {
      stone: owned[0]!,
      carvedStone: owned[1]!,
      dark: owned[2]!,
      jade: owned[3]!,
      goldDark: owned[4]!,
      gold: owned[5]!,
      wood: owned[6]!,
      leaf: owned[7]!,
    } as unknown as PureLandMaterials,
    owned,
  };
}

function cellMeshes(root: Group): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

function hasVertex(mesh: Mesh, x: number, y: number, z: number): boolean {
  const positions = mesh.geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    if (
      Math.abs(positions.getX(index) - x) < 1e-4 &&
      Math.abs(positions.getY(index) - y) < 1e-4 &&
      Math.abs(positions.getZ(index) - z) < 1e-4
    )
      return true;
  }
  return false;
}

describe('阶段 4 · 东侧水院独立 cell payload', () => {
  it.each([24, 48])('%d 米 payload 仅生成指定 cell 的构件', (cellSize) => {
    const { materials, owned } = createMaterials();
    const { pond } = LAND_WORLD.prototype.east;
    const coordinates = {
      column: Math.floor((pond.x - LAND_WORLD.cellOrigin.x) / cellSize),
      row: Math.floor((pond.z - LAND_WORLD.cellOrigin.z) / cellSize),
    };
    const payload = createEastRegionCellPayload(coordinates, materials, cellSize);
    const meshes = cellMeshes(payload.root);

    expect(payload.key).toBe(`${coordinates.column},${coordinates.row}`);
    expect(payload.root.userData['cell']).toBe(payload.key);
    expect(meshes.some(({ name }) => name === 'region-prototype-east-pond')).toBe(true);
    expect(meshes.some(({ name }) => name === 'region-prototype-east-pond-shore')).toBe(true);
    expect(meshes.filter(({ material }) => material === materials.dark)).toHaveLength(1);
    for (const mesh of meshes)
      if (mesh.userData['cell'] !== undefined) expect(mesh.userData['cell']).toBe(payload.key);

    payload.dispose();
    for (const material of owned) material.dispose();
  });

  it.each([24, 48])('%d 米路侧双树花台完整归属单个 cell', (cellSize) => {
    const { materials, owned } = createMaterials();
    const planting = LAND_WORLD.prototype.east.roadsidePlanting;

    for (const bed of planting.beds) {
      const coordinates = {
        column: Math.floor((bed.x - LAND_WORLD.cellOrigin.x) / cellSize),
        row: Math.floor((bed.z - LAND_WORLD.cellOrigin.z) / cellSize),
      };
      const payload = createEastRegionCellPayload(coordinates, materials, cellSize);
      const foliage = cellMeshes(payload.root).filter(
        ({ material }) => material === materials.leaf,
      );

      expect(foliage).toHaveLength(1);
      expect(foliage[0]!.userData['cell']).toBe(payload.key);
      const bounds = new Box3().setFromObject(foliage[0]!);
      const cellMinX = LAND_WORLD.cellOrigin.x + coordinates.column * cellSize;
      const cellMinZ = LAND_WORLD.cellOrigin.z + coordinates.row * cellSize;
      expect(bounds.min.x).toBeGreaterThanOrEqual(cellMinX);
      expect(bounds.max.x).toBeLessThanOrEqual(cellMinX + cellSize);
      expect(bounds.min.z).toBeGreaterThanOrEqual(cellMinZ);
      expect(bounds.max.z).toBeLessThanOrEqual(cellMinZ + cellSize);

      payload.dispose();
    }

    for (const material of owned) material.dispose();
  });

  it.each([24, 48])('%d 米步桥支路在 cell Z 边界处分段且无漏段', (cellSize) => {
    const { materials, owned } = createMaterials();
    const { east } = LAND_WORLD.prototype;
    const { bridge } = east.pond;
    const { width } = east.bridgeApproach;
    const startZ = bridge.maxZ;
    const endZ = east.route.minZ;
    const leftX = bridge.centerX - width / 2;
    const rightX = bridge.centerX + width / 2;
    let segmentStart: number = startZ;

    while (segmentStart < endZ) {
      const row = Math.floor((segmentStart - LAND_WORLD.cellOrigin.z) / cellSize);
      const cellMaxZ = LAND_WORLD.cellOrigin.z + (row + 1) * cellSize;
      const segmentEnd = Math.min(endZ, cellMaxZ);
      const coordinates = {
        column: Math.floor((bridge.centerX - LAND_WORLD.cellOrigin.x) / cellSize),
        row,
      };
      const payload = createEastRegionCellPayload(coordinates, materials, cellSize);
      const paving = cellMeshes(payload.root).find(({ material }) => material === materials.stone);

      expect(paving).toBeDefined();
      for (const x of [leftX, rightX])
        for (const z of [segmentStart, segmentEnd])
          expect(hasVertex(paving!, x, LAND_REGION_SURFACE_HEIGHT, z)).toBe(true);

      const ground = cellMeshes(payload.root).find(({ material }) => material === materials.dark);
      expect(ground).toBeDefined();
      for (const x of [leftX, rightX])
        for (const z of [segmentStart, segmentEnd])
          expect(hasVertex(ground!, x, east.groundHeight, z)).toBe(true);

      payload.dispose();
      segmentStart = segmentEnd;
    }

    expect(segmentStart).toBe(endZ);
    for (const material of owned) material.dispose();
  });

  it.each([24, 48])('%d 米路面 cell 不在铺装下重复生成同高地基', (cellSize) => {
    const { materials, owned } = createMaterials();
    const { route } = LAND_WORLD.prototype.east;
    const region = LAND_WORLD.regions.find(({ id }) => id === 'east-water-court')!;
    const x = Math.max(region.bounds.minX, route.minX) + cellSize / 2;
    const z = (route.minZ + route.maxZ) / 2;
    const coordinates = {
      column: Math.floor((x - LAND_WORLD.cellOrigin.x) / cellSize),
      row: Math.floor((z - LAND_WORLD.cellOrigin.z) / cellSize),
    };
    const payload = createEastRegionCellPayload(coordinates, materials, cellSize);
    const ground = cellMeshes(payload.root).find(({ material }) => material === materials.dark);
    expect(ground).toBeDefined();
    const positions = ground!.geometry.getAttribute('position');
    const groundZ = Array.from({ length: positions.count }, (_, index) => positions.getZ(index));
    const groundMinZ = LAND_WORLD.cellOrigin.z + coordinates.row * cellSize;
    const groundMaxZ = groundMinZ + cellSize;

    expect(groundZ).toContain(Math.max(route.minZ, groundMinZ));
    expect(groundZ).toContain(Math.min(route.maxZ, groundMaxZ));
    expect(groundZ).not.toContain(z);

    payload.dispose();
    for (const material of owned) material.dispose();
  });

  it('释放一个 cell 只销毁自己的几何，不销毁共享材质或相邻 payload', () => {
    const { materials, owned } = createMaterials();
    const bed = LAND_WORLD.prototype.east.roadsidePlanting.beds[0]!;
    const plantedCell = {
      column: Math.floor((bed.x - LAND_WORLD.cellOrigin.x) / LAND_WORLD.cellSize),
      row: Math.floor((bed.z - LAND_WORLD.cellOrigin.z) / LAND_WORLD.cellSize),
    };
    const first = createEastRegionCellPayload(plantedCell, materials);
    const second = createEastRegionCellPayload(
      { column: plantedCell.column + 1, row: plantedCell.row },
      materials,
    );
    expect(cellMeshes(first.root).some(({ material }) => material === materials.leaf)).toBe(true);
    const parent = new Group();
    parent.add(first.root, second.root);
    const geometries = cellMeshes(first.root).map(({ geometry }) => geometry);
    const geometryDisposals = geometries.map(() => vi.fn());
    geometries.forEach((geometry, index) =>
      geometry.addEventListener('dispose', geometryDisposals[index]!),
    );
    const materialDispose = vi.fn();
    materials.jade.addEventListener('dispose', materialDispose);
    const foliageMaterialDispose = vi.fn();
    materials.leaf.addEventListener('dispose', foliageMaterialDispose);

    first.dispose();
    first.dispose();

    expect(parent.children).toEqual([second.root]);
    expect(first.root.children).toHaveLength(0);
    expect(geometryDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(cellMeshes(second.root).length).toBeGreaterThan(0);
    expect(materialDispose).not.toHaveBeenCalled();
    expect(foliageMaterialDispose).not.toHaveBeenCalled();

    second.dispose();
    for (const material of owned) material.dispose();
  });

  it('拒绝落在东区之外的 cell 坐标', () => {
    const { materials, owned } = createMaterials();
    expect(() => createEastRegionCellPayload({ column: 0, row: 0 }, materials)).toThrow(
      '不属于东侧水院',
    );
    expect(() => createEastRegionCellPayload({ column: 10.5, row: 5 }, materials)).toThrow(
      '坐标必须是整数',
    );
    for (const material of owned) material.dispose();
  });
});
