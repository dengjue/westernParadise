import { describe, expect, it } from 'vitest';
import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import { LAND_GARDEN, LAND_GARDEN_QUALITY, PURE_LAND } from '@/01-shared';
import { createGardenLayout, isPondClear, sampleGardenLeaf } from '@/02-core';
import type { PondCircle } from '@/02-core';
import type { PureLandMaterials } from '@/05-materials';
import { createGardenWind } from '@/05-materials';
import { createGarden } from '@/06-world/land/Garden';
import { LandBuilder } from '@/06-world/land/Builder';
import { lilyGeometry, lotusPetalGeometry, treeLeafGeometry } from '@/06-world/land/GardenGeometry';
import { partitionGarden } from '@/06-world/land/SpatialGarden';
import { DistanceLod } from '@/04-engine';

function materials(): PureLandMaterials {
  return {
    stone: new MeshStandardMaterial(),
    carvedStone: new MeshStandardMaterial(),
    gold: new MeshStandardMaterial(),
    goldDark: new MeshStandardMaterial(),
    sculpture: new MeshStandardMaterial(),
    sculptureFold: new MeshStandardMaterial(),
    jade: new MeshStandardMaterial(),
    roof: new MeshStandardMaterial(),
    tileEnd: new MeshStandardMaterial(),
    frieze: new MeshStandardMaterial(),
    wood: new MeshStandardMaterial(),
    dark: new MeshStandardMaterial(),
    pearl: new MeshStandardMaterial(),
    glow: new MeshBasicMaterial(),
    leaf: new MeshStandardMaterial(),
    lily: new MeshStandardMaterial(),
    lotus: LAND_GARDEN.lotus.colors.map(() => new MeshStandardMaterial()),
  };
}

function measure(root: Group) {
  const buffers = new Set<unknown>();
  let triangles = 0,
    geometryBytes = 0,
    instanceBytes = 0,
    calls = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    calls++;
    const geometry: BufferGeometry = object.geometry;
    triangles +=
      ((geometry.index?.count ?? geometry.getAttribute('position').count) / 3) *
      (object instanceof InstancedMesh ? object.count : 1);
    const account = (
      attribute: { array: ArrayLike<number> & { byteLength: number } },
      instance = false,
    ) => {
      if (buffers.has(attribute)) return;
      buffers.add(attribute);
      if (instance) instanceBytes += attribute.array.byteLength;
      else geometryBytes += attribute.array.byteLength;
    };
    if (geometry.index) account(geometry.index);
    for (const attribute of Object.values(geometry.attributes))
      account(attribute, 'isInstancedBufferAttribute' in attribute);
    if (object instanceof InstancedMesh) {
      account(object.instanceMatrix, true);
      if (object.instanceColor) account(object.instanceColor, true);
    }
  });
  return { triangles, geometryBytes, instanceBytes, calls };
}

function dispose(root: Group, fixture: PureLandMaterials): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    if (object.name === 'garden-crown-shadow-proxy') object.material.dispose();
  });
  for (const value of Object.values(fixture)) {
    if (Array.isArray(value)) for (const material of value) material.dispose();
    else value.dispose();
  }
}

describe('稳定园林布局', () => {
  it('同 seed 重建逐位一致，独立叶片抽样不影响骨架与花心，不同 seed 有变化', () => {
    const first = createGardenLayout(20261113);
    for (let index = 0; index < 1000; index++) sampleGardenLeaf(20261113, first.trees[0]!, index);
    expect(createGardenLayout(20261113)).toEqual(first);
    const other = createGardenLayout(20261114);
    expect(other.trees.map((tree) => tree.height)).not.toEqual(
      first.trees.map((tree) => tree.height),
    );
    expect(other.lotuses.map((flower) => [flower.x, flower.z])).not.toEqual(
      first.lotuses.map((flower) => [flower.x, flower.z]),
    );
    expect(first.trees).toHaveLength(28);
    expect(first.lotuses).toHaveLength(LAND_GARDEN.lotus.count);
    for (const side of [-1, 1]) {
      expect(
        new Set(
          first.lotuses
            .filter((flower) => Math.sign(flower.x) === side)
            .map((flower) => flower.color),
        ).size,
      ).toBe(4);
    }
  });

  it('多个种子的花瓣/莲叶连同风动外包围均不进入池岸、树岛或彼此重叠', () => {
    for (const seed of [0, 1, 7, 42, 20261113, 20261114, 0xffffffff]) {
      const layout = createGardenLayout(seed);
      const circles: PondCircle[] = layout.lotuses.flatMap((flower) => [flower, ...flower.leaves]);
      expect(circles).toHaveLength(LAND_GARDEN.lotus.count * (1 + LAND_GARDEN.lily.perFlower));
      for (let i = 0; i < circles.length; i++) {
        expect(isPondClear(circles[i]!, layout.trees), `seed=${seed}, circle=${i}`).toBe(true);
        for (let j = i + 1; j < circles.length; j++) {
          const a = circles[i]!,
            b = circles[j]!;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(
            a.radius + b.radius + LAND_GARDEN.pond.clearance,
          );
        }
      }
    }
  });

  it('连续种子与高位种子均能在有限次数内完成布局', () => {
    for (let seed = 0; seed < 64; seed++) {
      expect(createGardenLayout(Math.imul(seed + 1, 0x9e3779b1)).lotuses).toHaveLength(
        LAND_GARDEN.lotus.count,
      );
    }
  });
});

describe('曲面植物与风动', () => {
  it.each([24, 48])(
    '%d 米植物分块无实例丢失，三级共享矩阵/颜色/风属性，远景仍覆盖每棵树',
    (cellSize) => {
      const root = new Group(),
        fixture = materials(),
        builder = new LandBuilder();
      const garden = createGarden(root, builder, fixture, 20261113, 'high', false);
      builder.flush(root);
      const sources = new Map(
        root.children
          .filter(
            (object): object is InstancedMesh =>
              object instanceof InstancedMesh && object.name !== 'garden-crown-shadow-proxy',
          )
          .map((object) => [object.name, object]),
      );
      partitionGarden(root, garden.layout.trees, 'high', cellSize);
      root.updateMatrixWorld(true);
      const covered = new Map<string, Set<number>>();
      for (const lod of root.children) {
        if (!(lod instanceof DistanceLod)) continue;
        const base = lod.children[0] as InstancedMesh,
          original = sources.get(base.name)!;
        const indices = base.userData['sourceIndices'] as Uint32Array;
        const seen = covered.get(base.name) ?? new Set<number>();
        covered.set(base.name, seen);
        for (let i = 0; i < indices.length; i++) {
          const source = indices[i]!;
          expect(seen.has(source)).toBe(false);
          seen.add(source);
          expect(base.instanceMatrix.array.slice(i * 16, i * 16 + 16)).toEqual(
            original.instanceMatrix.array.slice(source * 16, source * 16 + 16),
          );
        }
        const version = base.instanceMatrix.version;
        garden.update(120);
        expect(base.instanceMatrix.version).toBe(version);
        for (const object of lod.children) {
          const mesh = object as InstancedMesh;
          expect(mesh.instanceMatrix).toBe(base.instanceMatrix);
          expect(mesh.instanceColor).toBe(base.instanceColor);
          expect(mesh.geometry.getAttribute('gardenWind')).toBe(
            base.geometry.getAttribute('gardenWind'),
          );
          expect(mesh.geometry.index!.count).toBeLessThanOrEqual(base.geometry.index!.count);
          if (base.name !== 'jewel-tree-leaves') expect(mesh.count).toBe(base.count);
          else {
            const trees = (ids: Uint32Array) =>
              new Set(
                Array.from(ids, (id) => Math.floor(id / LAND_GARDEN_QUALITY.high.leavesPerTree)),
              );
            expect(trees(indices.slice(0, mesh.count))).toEqual(trees(indices));
          }
        }
      }
      for (const [name, source] of sources) expect(covered.get(name)!.size).toBe(source.count);
      dispose(root, fixture);
    },
  );

  it('四档曲面坐标与法线有限；莲叶朝上且边缘高于叶心', () => {
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      for (const geometry of [
        treeLeafGeometry(quality),
        lotusPetalGeometry(quality),
        lilyGeometry(quality),
      ]) {
        for (const name of ['position', 'normal', 'uv'])
          for (const value of geometry.getAttribute(name).array)
            expect(Number.isFinite(value)).toBe(true);
        geometry.dispose();
      }
      const leaf = lilyGeometry(quality),
        normal = leaf.getAttribute('normal');
      for (let index = 0; index < normal.count; index++)
        expect(normal.getY(index)).toBeGreaterThanOrEqual(0);
      leaf.computeBoundingBox();
      expect(leaf.boundingBox!.max.y).toBeGreaterThan(0.04);
      expect(leaf.boundingBox!.min.y + PURE_LAND.waterY + LAND_GARDEN.lily.height).toBeGreaterThan(
        PURE_LAND.waterY + 0.04,
      );
      leaf.dispose();
    }
  });

  it('减动效的幅度和时钟归零，普通模式只更新时间引用', () => {
    const still = createGardenWind(true),
      moving = createGardenWind(false);
    const uniform = moving.uniforms.gardenTime;
    still.update(123);
    moving.update(123);
    expect(still.uniforms.gardenMotion.value).toBe(0);
    expect(still.uniforms.gardenTime.value).toBe(0);
    expect(moving.uniforms.gardenTime).toBe(uniform);
    expect(moving.uniforms.gardenTime.value).toBe(123);
  });

  it('high/low 真正构建后的主布局和叶片子集一致，风动不重传实例矩阵且包围体有余量', () => {
    const roots: Group[] = [],
      fixtures: PureLandMaterials[] = [],
      gardens = [],
      reports = [];
    for (const quality of ['high', 'low'] as const) {
      const root = new Group(),
        builder = new LandBuilder(),
        fixture = materials();
      const garden = createGarden(root, builder, fixture, 20261113, quality, false);
      builder.flush(root);
      roots.push(root);
      fixtures.push(fixture);
      gardens.push(garden);
      const leaves = root.getObjectByName('jewel-tree-leaves') as InstancedMesh;
      const before = leaves.instanceMatrix.array.slice(),
        version = leaves.instanceMatrix.version;
      garden.update(30);
      expect(leaves.instanceMatrix.array).toEqual(before);
      expect(leaves.instanceMatrix.version).toBe(version);
      expect(leaves.castShadow).toBe(false);
      const matrix = new Matrix4(),
        point = new Vector3();
      const geometry = leaves.geometry,
        vertices = geometry.getAttribute('position');
      for (let instance = 0; instance < leaves.count; instance += 31) {
        leaves.getMatrixAt(instance, matrix);
        for (let vertex = 0; vertex < vertices.count; vertex++) {
          point.fromBufferAttribute(vertices, vertex).applyMatrix4(matrix);
          expect(
            leaves.boundingSphere!.radius - leaves.boundingSphere!.center.distanceTo(point),
          ).toBeGreaterThanOrEqual(LAND_GARDEN.wind.treeBounds - 0.001);
        }
      }
      reports.push({ quality, ...measure(root) });
    }
    expect(gardens[0]!.layout).toEqual(gardens[1]!.layout);
    const high = roots[0]!.getObjectByName('jewel-tree-leaves') as InstancedMesh;
    const low = roots[1]!.getObjectByName('jewel-tree-leaves') as InstancedMesh;
    const a = new Matrix4(),
      b = new Matrix4();
    for (let tree = 0; tree < 28; tree++)
      for (let index = 0; index < LAND_GARDEN_QUALITY.low.leavesPerTree; index++) {
        high.getMatrixAt(tree * LAND_GARDEN_QUALITY.high.leavesPerTree + index, a);
        low.getMatrixAt(tree * LAND_GARDEN_QUALITY.low.leavesPerTree + index, b);
        expect(a.elements).toEqual(b.elements);
      }
    expect(reports[0]!.triangles).toBeLessThan(950_000);
    expect(reports[1]!.triangles).toBeLessThan(reports[0]!.triangles);
    if (process.env.LAND_GARDEN_REPORT === '1') console.info(JSON.stringify(reports, null, 2));
    for (let index = 0; index < roots.length; index++) dispose(roots[index]!, fixtures[index]!);
  });
});
