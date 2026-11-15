import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { LAND_WORLD } from '@/01-shared';
import type { PureLandMaterials } from '@/05-materials';
import { createEastRegionCellPayload } from '@/06-world/land/RegionPrototype';

function createMaterials(): {
  materials: PureLandMaterials;
  owned: MeshStandardMaterial[];
} {
  const owned = Array.from({ length: 6 }, () => new MeshStandardMaterial());
  return {
    materials: {
      stone: owned[0]!,
      carvedStone: owned[1]!,
      dark: owned[2]!,
      jade: owned[3]!,
      goldDark: owned[4]!,
      gold: owned[5]!,
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

  it('释放一个 cell 只销毁自己的几何，不销毁共享材质或相邻 payload', () => {
    const { materials, owned } = createMaterials();
    const pond = LAND_WORLD.prototype.east.pond;
    const pondCell = {
      column: Math.floor((pond.x - LAND_WORLD.cellOrigin.x) / LAND_WORLD.cellSize),
      row: Math.floor((pond.z - LAND_WORLD.cellOrigin.z) / LAND_WORLD.cellSize),
    };
    const first = createEastRegionCellPayload(pondCell, materials);
    const second = createEastRegionCellPayload(
      { column: pondCell.column + 1, row: pondCell.row },
      materials,
    );
    const parent = new Group();
    parent.add(first.root, second.root);
    const geometries = cellMeshes(first.root).map(({ geometry }) => geometry);
    const geometryDisposals = geometries.map(() => vi.fn());
    geometries.forEach((geometry, index) =>
      geometry.addEventListener('dispose', geometryDisposals[index]!),
    );
    const materialDispose = vi.fn();
    materials.jade.addEventListener('dispose', materialDispose);

    first.dispose();
    first.dispose();

    expect(parent.children).toEqual([second.root]);
    expect(first.root.children).toHaveLength(0);
    expect(geometryDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(cellMeshes(second.root).length).toBeGreaterThan(0);
    expect(materialDispose).not.toHaveBeenCalled();

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
