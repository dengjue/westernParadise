import {
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Vector3,
} from 'three';
import type { Group } from 'three';
import type { QualityTier } from '@/00-types';
import { LAND_GARDEN_QUALITY, LAND_RENDER } from '@/01-shared';
import type { GardenTree } from '@/02-core';
import { DistanceLod } from '@/04-engine';
import {
  finishGardenInstances,
  lilyGeometry,
  lotusPetalGeometry,
  treeLeafGeometry,
} from './GardenGeometry';

/** 六类植物按池区拆批；矩阵/颜色/风属性在三级间共享，级别切换不触发上传。 */
export function partitionGarden(
  root: Group,
  trees: readonly GardenTree[],
  quality: QualityTier,
  cellSize: number,
  cellOrigin: readonly [number, number] = [0, 0],
): void {
  const sources = root.children.filter(
    (object): object is InstancedMesh =>
      object instanceof InstancedMesh && object.name !== 'garden-crown-shadow-proxy',
  );
  for (const source of sources) {
    const tree = source.name === 'jewel-tree-leaves',
      lily = source.name === 'lotus-leaves';
    const create = tree ? treeLeafGeometry : lily ? lilyGeometry : lotusPetalGeometry;
    const prototypes = [
      source.geometry,
      create(quality === 'low' ? 'low' : 'medium'),
      create('low'),
    ];
    const perTree = LAND_GARDEN_QUALITY[quality].leavesPerTree;
    const cells = new Map<string, number[]>();
    const matrix = new Matrix4(),
      color = new Color(),
      center = new Vector3();
    for (let index = 0; index < source.count; index++) {
      const plant = tree ? trees[Math.floor(index / perTree)] : undefined;
      const x = plant?.x ?? source.instanceMatrix.array[index * 16 + 12]!;
      const z = plant?.z ?? source.instanceMatrix.array[index * 16 + 14]!;
      const key = `${Math.floor((x - cellOrigin[0]) / cellSize)},${Math.floor((z - cellOrigin[1]) / cellSize)}`;
      const indices = cells.get(key);
      if (indices) indices.push(index);
      else cells.set(key, [index]);
    }
    for (const [cell, indices] of cells) {
      // 先叶序号、再树 ID；任意稳定前缀都同时覆盖区块中的各棵树。
      if (tree) indices.sort((a, b) => (a % perTree) - (b % perTree) || a - b);
      const wind = new InstancedBufferAttribute(new Float32Array(indices.length * 4), 4);
      const levels = prototypes.map((prototype, level) => {
        const geometry = new BufferGeometry();
        geometry.setIndex(prototype.index);
        for (const name of ['position', 'normal', 'uv'])
          geometry.setAttribute(name, prototype.getAttribute(name));
        geometry.setAttribute('gardenWind', wind);
        const mesh = new InstancedMesh(geometry, source.material, indices.length);
        mesh.name = source.name;
        mesh.receiveShadow = source.receiveShadow;
        mesh.layers.enable(LAND_RENDER.layers.reflection);
        mesh.userData['cell'] = cell;
        mesh.userData['lodLevel'] = level;
        return mesh;
      });
      const base = levels[0]!,
        inputWind = source.geometry.getAttribute('gardenWind');
      for (let index = 0; index < indices.length; index++) {
        const original = indices[index]!;
        source.getMatrixAt(original, matrix);
        base.setMatrixAt(index, matrix);
        if (source.instanceColor) {
          source.getColorAt(original, color);
          base.setColorAt(index, color);
        }
        wind.setXYZW(
          index,
          inputWind.getX(original),
          inputWind.getY(original),
          inputWind.getZ(original),
          inputWind.getW(original),
        );
      }
      const margin = source.userData['windMargin'] as number;
      finishGardenInstances(base, margin);
      base.userData['sourceIndices'] = new Uint32Array(indices);
      for (let level = 1; level < levels.length; level++) {
        const mesh = levels[level]!;
        mesh.instanceMatrix = base.instanceMatrix;
        mesh.instanceColor = base.instanceColor;
        mesh.boundingBox = base.boundingBox;
        mesh.boundingSphere = base.boundingSphere;
        mesh.count = tree
          ? Math.ceil(indices.length * LAND_RENDER.lod.leafRatios[level]!)
          : indices.length;
      }
      base.boundingBox!.getCenter(center);
      const settings = LAND_RENDER.lod.plant;
      const lod = new DistanceLod(
        levels,
        [center.x, center.y, center.z],
        base.boundingSphere!.radius,
        settings.distances,
        settings.hysteresis,
        0,
      );
      lod.userData['kind'] = 'plant';
      root.add(lod);
    }
    root.remove(source);
    for (const geometry of prototypes) geometry.dispose();
  }
  const proxy = root.getObjectByName('garden-crown-shadow-proxy');
  proxy?.layers.set(LAND_RENDER.layers.shadow);
}
