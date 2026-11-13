import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute } from 'three';
import type { InstancedMesh } from 'three';
import { LAND_GARDEN, LAND_GARDEN_QUALITY } from '@/01-shared';
import type { QualityTier } from '@/00-types';

/** 连续参数网格保留中央脊，叶根/瓣根收束到原点供 GPU 风动使用。 */
function surface(
  rows: number,
  columns: number,
  sample: (t: number, u: number) => [number, number, number],
  upward: boolean,
): BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let col = 0; col <= columns; col++) {
      positions.push(...sample(row / rows, col / columns));
      uvs.push(col / columns, row / rows);
    }
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col,
        b = a + columns + 1;
      if (upward) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function treeLeafGeometry(quality: QualityTier): BufferGeometry {
  const leaf = LAND_GARDEN.trees.leaf;
  return surface(
    LAND_GARDEN_QUALITY[quality].leafRows,
    2,
    (t, across) => {
      const u = across * 2 - 1,
        width = Math.sin(Math.PI * t) ** 0.85;
      return [
        u * width * leaf.halfWidth,
        t * leaf.length,
        Math.sin(Math.PI * t) * (1 - u * u) * leaf.cup - t * t * leaf.droop,
      ];
    },
    false,
  );
}

export function lotusPetalGeometry(quality: QualityTier): BufferGeometry {
  const petal = LAND_GARDEN.lotus.petal,
    detail = LAND_GARDEN_QUALITY[quality];
  return surface(
    detail.petalRows,
    detail.petalColumns,
    (t, across) => {
      const u = across * 2 - 1;
      return [
        u * Math.sin(Math.PI * t) ** 0.8 * petal.halfWidth,
        t * t * petal.rise + u * u * Math.sin(Math.PI * t) * petal.cup,
        t * petal.length,
      ];
    },
    true,
  );
}

/** 缺口从叶缘延伸至叶心；外缘轻翘，中部凹陷，在掠射光下仍有形体。 */
export function lilyGeometry(quality: QualityTier): BufferGeometry {
  const leaf = LAND_GARDEN.lily,
    detail = LAND_GARDEN_QUALITY[quality];
  const geometry = surface(
    detail.lilyRows,
    detail.lilySegments,
    (r, u) => {
      const angle = leaf.notch + u * (Math.PI * 2 - leaf.notch * 2);
      const radial = r * (1 + 0.025 * Math.sin(angle * 3) * r);
      return [
        Math.sin(angle) * radial,
        leaf.edgeLift * r ** 3 + leaf.wave * Math.sin(angle * 5) * r * r,
        Math.cos(angle) * radial,
      ];
    },
    true,
  );
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++)
    uv.setXY(i, position.getX(i) * 0.48 + 0.5, position.getZ(i) * 0.48 + 0.5);
  return geometry;
}

/** 同一花瓣原型的 position/normal/uv/index 共享，只有每批风属性独立。 */
export function windGeometry(base: BufferGeometry, count: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setIndex(base.index);
  for (const [name, attribute] of Object.entries(base.attributes))
    geometry.setAttribute(name, attribute);
  geometry.setAttribute('gardenWind', new InstancedBufferAttribute(new Float32Array(count * 4), 4));
  return geometry;
}

export function finishGardenInstances(mesh: InstancedMesh, margin: number): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.geometry.getAttribute('gardenWind').needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.boundingBox!.expandByScalar(margin);
  mesh.boundingSphere!.radius += margin;
  mesh.userData['windMargin'] = margin;
}
