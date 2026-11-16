import {
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Vector3,
} from 'three';
import { LAND_CRAFT, LAND_DETAIL } from '@/01-shared';
import type { LandDetail } from '@/01-shared';
import type { PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';

export interface RoofSpec {
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  height: number;
}

/** 相邻坡面共享同一个角点公式，檐角与垂脊不会各自采样成裂缝。 */
export function roofPoint(
  u: number,
  t: number,
  face: number,
  width: number,
  depth: number,
  rise: number,
): Vector3 {
  const { cornerLift, ridgeFraction, skirtFraction } = LAND_CRAFT.roof;
  const edge = Math.abs(u) ** 4 * t ** 4 * rise * cornerLift;
  const y = rise * (1 - t) ** 1.7 + edge;
  if (face < 2)
    return new Vector3(
      u * width * (ridgeFraction + skirtFraction * t),
      y,
      (face === 0 ? 1 : -1) * depth * 0.5 * t,
    );
  return new Vector3(
    (face === 2 ? 1 : -1) * width * (ridgeFraction + skirtFraction * t),
    y,
    u * depth * 0.5 * t,
  );
}

export function roofGeometry(b: RoofSpec, detail: LandDetail): BufferGeometry {
  const { roofColumns: columns, roofRows: rows } = LAND_DETAIL[detail];
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let face = 0; face < 4; face++) {
    const offset = positions.length / 3;
    for (let row = 0; row <= rows; row++)
      for (let col = 0; col <= columns; col++) {
        const p = roofPoint((col / columns) * 2 - 1, row / rows, face, b.width, b.depth, b.height);
        positions.push(p.x, p.y, p.z);
        uvs.push(((col / columns) * (face < 2 ? b.width : b.depth)) / 9, row / rows);
      }
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        const a = offset + row * (columns + 1) + col,
          c = a + columns + 1;
        if (face === 0 || face === 3) indices.push(a, c, a + 1, a + 1, c, c + 1);
        else indices.push(a, a + 1, c, a + 1, c + 1, c);
      }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function fascia(b: RoofSpec, columns: number): BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let face = 0; face < 4; face++) {
    const offset = positions.length / 3;
    for (let col = 0; col <= columns; col++) {
      const p = roofPoint((col / columns) * 2 - 1, 1, face, b.width, b.depth, b.height);
      positions.push(p.x, p.y, p.z, p.x, p.y - LAND_CRAFT.roof.thickness, p.z);
      uvs.push((col / columns) * b.width, 1, (col / columns) * b.width, 0);
    }
    for (let col = 0; col < columns; col++) {
      const a = offset + col * 2;
      if (face === 0 || face === 3) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function* createRoofBody(
  builder: LandBuilder,
  m: PureLandMaterials,
  b: RoofSpec,
  detail: LandDetail,
): Generator<void, void, void> {
  const settings = LAND_DETAIL[detail],
    craft = LAND_CRAFT.roof;
  const geometry = roofGeometry(b, detail);
  let geometryTransferred = false,
    underside: BufferGeometry | undefined,
    undersideTransferred = false;
  try {
    underside = geometry.clone();
    yield;
    underside.translate(0, -craft.thickness, 0);
    const index = underside.index!;
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, second);
    }
    underside.computeVertexNormals();
    yield;

    geometryTransferred = true;
    yield* builder.shapeOwnedSteps(geometry, m.roof, [b.x, b.base, b.z]);
    undersideTransferred = true;
    yield* builder.shapeOwnedSteps(underside, m.wood, [b.x, b.base, b.z]);
  } finally {
    if (!geometryTransferred) geometry.dispose();
    if (underside && !undersideTransferred) {
      underside.dispose();
    }
  }
  yield;

  const edgeBody = fascia(b, settings.roofColumns);
  yield* builder.shapeOwnedSteps(edgeBody, m.goldDark, [b.x, b.base, b.z]);

  for (let face = 0; face < 4; face++) {
    const edge: [number, number, number][] = [];
    for (let col = 0; col <= settings.roofColumns; col++) {
      const p = roofPoint(
        (col / settings.roofColumns) * 2 - 1,
        1,
        face,
        b.width,
        b.depth,
        b.height,
      );
      edge.push([b.x + p.x, b.base + p.y, b.z + p.z]);
    }
    builder.tube(m.gold, edge, craft.eaveRadius, settings.roofColumns);
    yield;
  }
  // 用前后两坡的左右端点生成四条垂脊，避免同一角点重复、另一角点遗漏。
  for (const face of [0, 1])
    for (const side of [-1, 1]) {
      const hip: [number, number, number][] = [];
      for (let row = 0; row <= settings.roofRows; row++) {
        const p = roofPoint(side, row / settings.roofRows, face, b.width, b.depth, b.height);
        hip.push([b.x + p.x, b.base + p.y + 0.04, b.z + p.z]);
      }
      builder.tube(m.gold, hip, craft.ridgeRadius, settings.roofRows);
      yield;
    }

  if (settings.tileSpacing > 0) {
    const barrel = new CylinderGeometry(
      craft.tileRadius,
      craft.tileRadius,
      craft.tileDepth,
      12,
    ).rotateX(Math.PI / 2);
    const medallion = new CircleGeometry(craft.tileRadius * 0.9, 12);
    try {
      const count = Math.floor(b.width / settings.tileSpacing);
      for (const face of [0, 1])
        for (let i = 0; i <= count; i++) {
          const u = (i / count) * 2 - 1,
            side = face === 0 ? 1 : -1;
          const p = roofPoint(u, 1, face, b.width, b.depth, b.height);
          const center: [number, number, number] = [
            b.x + p.x,
            b.base + p.y - 0.1,
            b.z + p.z + side * 0.045,
          ];
          builder.shape(barrel, m.roof, center);
          builder.shape(
            medallion,
            m.tileEnd,
            [center[0], center[1], center[2] + side * (craft.tileDepth / 2 + 0.002)],
            [1, 1, 1],
            face === 0 ? 0 : Math.PI,
          );
          const rib: [number, number, number][] = [];
          for (let row = 0; row <= 10; row++) {
            const r = roofPoint(u, row / 10, face, b.width, b.depth, b.height);
            rib.push([b.x + r.x, b.base + r.y + 0.07, b.z + r.z]);
          }
          builder.tube(m.roof, rib, 0.075, 10);
          yield;
        }
    } finally {
      barrel.dispose();
      medallion.dispose();
    }
  }
  if (settings.rafters) {
    const count = Math.floor(b.width / craft.rafterSpacing);
    for (const face of [0, 1])
      for (let i = 1; i < count; i++) {
        const points: [number, number, number][] = [];
        for (let j = 0; j <= 5; j++) {
          const p = roofPoint(
            (i / count) * 2 - 1,
            0.48 + (j / 5) * 0.52,
            face,
            b.width,
            b.depth,
            b.height,
          );
          points.push([b.x + p.x, b.base + p.y - craft.thickness - craft.rafterRadius, b.z + p.z]);
        }
        builder.tube(m.wood, points, craft.rafterRadius, 5);
        yield;
      }
  }
  builder.box(m.gold, [b.x, b.base + b.height, b.z], [b.width * 0.53, 0.25, 0.3]);
  yield;
  for (const side of [-1, 1]) {
    const x = b.x + side * b.width * LAND_CRAFT.roof.ridgeFraction;
    builder.tube(
      m.gold,
      [
        [x - side * 0.6, b.base + b.height, b.z],
        [x + side * 0.5, b.base + b.height + 0.4, b.z],
        [x + side * 0.9, b.base + b.height + 1.1, b.z],
      ],
      0.2,
      10,
    );
    yield;
  }
}

/** 分层构建屋顶；yield 位于几何副本已交给 builder 的安全点。 */
export function* createRoofSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  b: RoofSpec,
  detail: LandDetail,
): Generator<void, void, void> {
  const handled = yield* builder.lodSteps(
    [b.x, b.base, b.z],
    Math.max(b.width, b.depth) / 2,
    'roof',
    detail,
    (level, next) => createRoofBody(level, m, b, next),
  );
  if (!handled) yield* createRoofBody(builder, m, b, detail);
}

/** 兼容同步构建调用者，消费同一确定性步骤序列至完成。 */
export function createRoof(
  builder: LandBuilder,
  m: PureLandMaterials,
  b: RoofSpec,
  detail: LandDetail,
): void {
  const steps = createRoofSteps(builder, m, b, detail);
  while (!steps.next().done) {
    // 同步调用保持既有行为；分帧入口直接驱动 createRoofSteps。
  }
}
