import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Object3D,
  Shape,
  ShapeGeometry,
} from 'three';
import type { Group } from 'three';
import type { QualityTier } from '@/00-types';
import { PURE_LAND } from '@/01-shared';
import { Rng } from '@/02-core';
import type { PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';

/** 花瓣是从花心向外舒展的双曲面，中央脊与尖端均有厚薄变化。 */
export function petalGeometry(): BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const rows = 7,
    columns = 6;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    for (let col = 0; col <= columns; col++) {
      const u = (col / columns) * 2 - 1;
      positions.push(
        u * Math.sin(Math.PI * t) * 0.48,
        t * t * 0.8 + u * u * Math.sin(Math.PI * t) * 0.2,
        t * 1.35,
      );
      uvs.push(col / columns, t);
    }
  }
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col,
        b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function trees(
  root: Group,
  builder: LandBuilder,
  m: PureLandMaterials,
  rng: Rng,
  quality: QualityTier,
): void {
  const perTree = PURE_LAND.rendering.leavesPerTree[quality];
  const leafShape = new Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(-0.55, 0.3, -0.45, 0.9, 0, 1.5);
  leafShape.bezierCurveTo(0.45, 0.9, 0.55, 0.3, 0, 0);
  const geometry = new ShapeGeometry(leafShape, 6);
  const leafPositions = geometry.getAttribute('position');
  const leafUvs = geometry.getAttribute('uv');
  for (let i = 0; i < leafPositions.count; i++) {
    const x = leafPositions.getX(i),
      y = leafPositions.getY(i),
      t = y / 1.5;
    leafPositions.setZ(i, Math.sin(t * Math.PI) * (1 - Math.abs(x) / 0.55) * 0.16 - t * t * 0.18);
    leafUvs.setXY(i, (x + 0.55) / 1.1, t);
  }
  geometry.computeVertexNormals();
  const leaves = new InstancedMesh(geometry, m.leaf, perTree * 28);
  leaves.name = 'jewel-tree-leaves';
  leaves.castShadow = quality === 'ultra';
  leaves.receiveShadow = true;
  const transform = new Object3D(),
    color = new Color();
  let leafIndex = 0;
  for (const side of [-1, 1])
    for (let row = 0; row < 7; row++)
      for (let lane = 0; lane < 2; lane++) {
        const x = side * (30 + lane * 17),
          z = -9 + row * 12.4;
        const height = rng.range(8.5, 12.2),
          radius = rng.range(3.2, 4.6);
        builder.box(m.stone, [x, 0.2, z], [6, 1.2, 6]);
        builder.box(m.gold, [x, 0.82, z], [6.1, 0.12, 6.1]);
        builder.box(m.jade, [x, 0.91, z], [5.5, 0.1, 5.5]);
        builder.tube(
          m.goldDark,
          [
            [x, 0.9, z],
            [x + side * 0.4, height * 0.38, z],
            [x - 0.3, height * 0.7, z + 0.3],
            [x, height, z],
          ],
          0.29,
          12,
        );
        for (let branch = 0; branch < 10; branch++) {
          const angle = (branch / 10) * Math.PI * 2 + row;
          const bx = x + Math.cos(angle) * radius * 0.85,
            bz = z + Math.sin(angle) * radius * 0.85;
          const by = height * rng.range(0.75, 1.03);
          builder.tube(
            m.goldDark,
            [
              [x, height * 0.43, z],
              [x + Math.cos(angle), height * 0.65, z + Math.sin(angle)],
              [bx, by, bz],
            ],
            0.085,
            9,
          );
          for (let twig = 0; twig < 2; twig++) {
            const tx = bx + Math.cos(angle + twig) * 1.2,
              tz = bz + Math.sin(angle + twig) * 1.2;
            builder.rod(m.goldDark, [bx, by, bz], [tx, by + 0.9, tz], 0.035);
          }
        }
        for (let i = 0; i < perTree; i++) {
          const angle = rng.range(0, Math.PI * 2),
            r = Math.sqrt(rng.next()) * radius;
          transform.position.set(
            x + Math.cos(angle) * r,
            height * 0.73 +
              Math.sqrt(Math.max(0, 1 - (r * r) / (radius * radius))) * 2.6 +
              rng.range(-0.9, 0.9),
            z + Math.sin(angle) * r,
          );
          transform.rotation.set(rng.range(-1.3, 1.3), angle, rng.range(-1.5, 1.5));
          transform.scale.setScalar(rng.range(0.5, 1.12));
          transform.updateMatrix();
          leaves.setMatrixAt(leafIndex, transform.matrix);
          color
            .setHSL(rng.range(0.15, 0.3), rng.range(0.3, 0.55), rng.range(0.42, 0.67))
            .convertSRGBToLinear();
          leaves.setColorAt(leafIndex++, color);
        }
        // 每列行树上垂一串双曲珠网，细珠用合批球体体现折光节点。
        if (row < 6 && lane === 1) {
          const line: [number, number, number][] = [];
          for (let i = 0; i <= 20; i++) {
            const t = i / 20,
              y = 8.3 - Math.sin(t * Math.PI) * 2.3;
            line.push([x, y, z + t * 12.4]);
            builder.sphere(m.pearl, [x, y, z + t * 12.4], [0.085, 0.085, 0.085]);
          }
          builder.tube(m.gold, line, 0.022, 20);
        }
      }
  leaves.instanceMatrix.needsUpdate = true;
  root.add(leaves);
}

function lotuses(
  root: Group,
  builder: LandBuilder,
  m: PureLandMaterials,
  rng: Rng,
  quality: QualityTier,
): void {
  const count = PURE_LAND.rendering.lotusCount[quality];
  const petalsPerFlower = 33;
  const petal = petalGeometry();
  const flowers = m.lotus.map((material) => {
    material.side = DoubleSide;
    const mesh = new InstancedMesh(petal, material, Math.ceil(count / 4) * petalsPerFlower);
    mesh.name = 'lotus-petals';
    mesh.receiveShadow = true;
    return mesh;
  });
  const counters = [0, 0, 0, 0];
  const leaf = new Shape();
  leaf.moveTo(0, 0);
  leaf.absarc(0, 0, 1, 0.12, Math.PI * 2 - 0.12, false);
  leaf.lineTo(0, 0);
  const lilyGeometry = new ShapeGeometry(leaf, 24);
  lilyGeometry.rotateX(-Math.PI / 2);
  const lilies = new InstancedMesh(lilyGeometry, m.lily, count * 2);
  lilies.name = 'lotus-leaves';
  lilies.receiveShadow = true;
  const transform = new Object3D();
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    let x = side * rng.range(10, 54),
      z = rng.range(-16, 72);
    // 岛台附近保留水道，避免荷叶穿进石台。
    if ((Math.abs(Math.abs(x) - 30) < 4 || Math.abs(Math.abs(x) - 47) < 4) && (z + 9) % 12.4 < 7)
      x = side * rng.range(11, 22);
    if (i < 4) {
      x = 12 + i * 3.2;
      z = 44 + (i % 2) * 4;
    }
    const size = rng.range(0.65, 1.35);
    const colorIndex = Math.floor(i / 2) % 4,
      flower = flowers[colorIndex]!;
    for (let layer = 0; layer < 3; layer++) {
      const petalCount = 13 - layer * 2;
      for (let p = 0; p < petalCount; p++) {
        const angle = ((p + layer * 0.35) / petalCount) * Math.PI * 2;
        transform.position.set(x, PURE_LAND.waterY + 0.15 + layer * 0.12 * size, z);
        transform.rotation.set(-layer * 0.17, angle, 0, 'YXZ');
        transform.scale.setScalar(size * (1 - layer * 0.19));
        transform.updateMatrix();
        flower.setMatrixAt(counters[colorIndex]!, transform.matrix);
        counters[colorIndex]!++;
      }
    }
    builder.sphere(
      m.gold,
      [x, PURE_LAND.waterY + 0.45, z],
      [0.26 * size, 0.14 * size, 0.26 * size],
    );
    for (let j = 0; j < 2; j++) {
      transform.position.set(
        x + rng.range(-1.2, 1.2),
        PURE_LAND.waterY + 0.035 + j * 0.009,
        z + rng.range(-1.2, 1.2),
      );
      transform.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      transform.scale.setScalar(size * rng.range(0.7, 1.15));
      transform.updateMatrix();
      lilies.setMatrixAt(i * 2 + j, transform.matrix);
    }
  }
  for (let i = 0; i < flowers.length; i++) {
    flowers[i]!.count = counters[i]!;
    flowers[i]!.instanceMatrix.needsUpdate = true;
    root.add(flowers[i]!);
  }
  lilies.instanceMatrix.needsUpdate = true;
  root.add(lilies);
}

export function createGarden(
  root: Group,
  builder: LandBuilder,
  m: PureLandMaterials,
  seed: number,
  quality: QualityTier,
): void {
  const rng = new Rng(seed);
  trees(root, builder, m, rng, quality);
  lotuses(root, builder, m, rng, quality);
  // 远景白鸟以弧形翼展形成剪影，帮助判断世界尺度。
  for (let i = 0; i < 9; i++) {
    const x = -40 + i * 5,
      y = 46 + Math.sin(i * 0.6) * 3,
      z = -105 - Math.abs(i - 4) * 3;
    for (const side of [-1, 1])
      builder.tube(
        m.pearl,
        [
          [x, y, z],
          [x + side * 0.8, y + 0.35, z + 0.1],
          [x + side * 1.9, y + 0.15, z + 0.6],
        ],
        0.075,
        8,
      );
  }
}
