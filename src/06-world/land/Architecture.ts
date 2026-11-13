import { BufferGeometry, Float32BufferAttribute, PlaneGeometry, Vector3 } from 'three';
import type { Material } from 'three';
import type { PureLandMaterials } from '@/05-materials';
import { PURE_LAND } from '@/01-shared';
import type { LandBuilder } from './Builder';

interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  height: number;
}

/** 四片连续曲面形成歇山意象，曲率在檐缘抬起；不用斜盒代替屋顶。 */
function roofPoint(
  u: number,
  t: number,
  face: number,
  width: number,
  depth: number,
  rise: number,
): Vector3 {
  const edge = Math.pow(Math.abs(u), 4) * Math.pow(t, 4) * rise * 0.32;
  const y = rise * Math.pow(1 - t, 1.7) + edge;
  if (face < 2)
    return new Vector3(u * width * (0.26 + 0.24 * t), y, (face === 0 ? 1 : -1) * depth * 0.5 * t);
  return new Vector3((face === 2 ? 1 : -1) * width * (0.26 + 0.24 * t), y, u * depth * 0.5 * t);
}

function roof(builder: LandBuilder, m: PureLandMaterials, b: Building, detailed = true): void {
  const rise = b.height;
  const columns = detailed ? 28 : 12;
  const rows = detailed ? 12 : 6;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let face = 0; face < 4; face++) {
    const offset = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        const p = roofPoint((col / columns) * 2 - 1, row / rows, face, b.width, b.depth, rise);
        positions.push(p.x, p.y, p.z);
        uvs.push(((col / columns) * (face < 2 ? b.width : b.depth)) / 9, row / rows);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const a = offset + row * (columns + 1) + col,
          c = a + columns + 1;
        if (face === 0 || face === 3) indices.push(a, c, a + 1, a + 1, c, c + 1);
        else indices.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    // 檐口与四条垂脊保留真实截面，高光随镜头变化。
    const edge: [number, number, number][] = [];
    for (let col = 0; col <= columns; col++) {
      const p = roofPoint((col / columns) * 2 - 1, 1, face, b.width, b.depth, rise);
      edge.push([b.x + p.x, b.base + p.y, b.z + p.z]);
    }
    builder.tube(m.gold, edge, detailed ? 0.14 : 0.09, columns);
    const hip: [number, number, number][] = [];
    for (let row = 0; row <= rows; row++) {
      const p = roofPoint(1, row / rows, face, b.width, b.depth, rise);
      hip.push([b.x + p.x, b.base + p.y + 0.04, b.z + p.z]);
    }
    builder.tube(m.gold, hip, 0.1, rows);
    if (detailed && face < 2) {
      // 瓦当独立成形，屋顶细纹由法线贴图接力，控制顶面几何预算。
      const count = Math.floor(b.width / 0.65);
      for (let i = 0; i <= count; i++) {
        const p = roofPoint((i / count) * 2 - 1, 1, face, b.width, b.depth, rise);
        builder.sphere(m.goldDark, [b.x + p.x, b.base + p.y - 0.16, b.z + p.z], [0.16, 0.17, 0.16]);
        const rib: [number, number, number][] = [];
        for (let row = 0; row <= 10; row++) {
          const r = roofPoint((i / count) * 2 - 1, row / 10, face, b.width, b.depth, rise);
          rib.push([b.x + r.x, b.base + r.y + 0.07, b.z + r.z]);
        }
        builder.tube(m.roof, rib, 0.075, 10);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  builder.shape(geometry, m.roof, [b.x, b.base, b.z]);
  geometry.dispose();
  builder.box(m.gold, [b.x, b.base + rise, b.z], [b.width * 0.53, 0.25, 0.3]);
  for (const side of [-1, 1]) {
    const x = b.x + side * b.width * 0.265;
    builder.tube(
      m.gold,
      [
        [x - side * 0.6, b.base + rise, b.z],
        [x + side * 0.5, b.base + rise + 0.4, b.z],
        [x + side * 0.9, b.base + rise + 1.1, b.z],
      ],
      0.2,
      10,
    );
  }
}

function column(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  base: number,
  height: number,
  radius: number,
): void {
  builder.cylinder(m.stone, [x, base + 0.32, z], radius * 1.8, 0.64);
  builder.cylinder(m.goldDark, [x, base + 0.64, z], radius * 1.4, 0.2);
  builder.cylinder(m.wood, [x, base + height / 2, z], radius, height);
  for (const y of [0.85, height - 0.5])
    builder.cylinder(m.gold, [x, base + y, z], radius * 1.06, 0.18);
  for (let level = 0; level < 3; level++) {
    const y = base + height - 0.4 + level * 0.27;
    builder.box(
      level === 1 ? m.jade : m.goldDark,
      [x, y, z],
      [radius * (3.8 + level), 0.22, radius * 1.4],
    );
    builder.box(m.gold, [x, y + 0.12, z], [radius * 1.3, 0.18, radius * (3 + level * 0.7)]);
  }
}

export function railing(
  builder: LandBuilder,
  m: PureLandMaterials,
  from: readonly [number, number],
  to: readonly [number, number],
  base = 1.3,
): void {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.ceil(length / 3.2);
  for (let i = 0; i <= count; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / count,
      z = from[1] + ((to[1] - from[1]) * i) / count;
    builder.box(m.stone, [x, base + 0.65, z], [0.32, 1.3, 0.32]);
    builder.sphere(m.gold, [x, base + 1.4, z], [0.23, 0.26, 0.23]);
    if (i < count) {
      for (let sub = 1; sub <= 3; sub++) {
        const t = (i + sub / 4) / count;
        builder.box(
          m.jade,
          [from[0] + (to[0] - from[0]) * t, base + 0.65, from[1] + (to[1] - from[1]) * t],
          [0.1, 0.75, 0.1],
        );
      }
    }
  }
  for (const y of [0.24, 1.18])
    builder.rod(m.gold, [from[0], base + y, from[1]], [to[0], base + y, to[1]], 0.09);
}

function pavilion(builder: LandBuilder, m: PureLandMaterials, b: Building, detailed = true): void {
  builder.box(m.stone, [b.x, b.base - 0.35, b.z], [b.width + 3, 0.7, b.depth + 3]);
  builder.box(m.goldDark, [b.x, b.base - 0.06, b.z], [b.width + 3.15, 0.12, b.depth + 3.15]);
  for (const side of [-1, 1]) {
    const columnCount = b.width > 30 ? 6 : 5;
    for (let i = 0; i < columnCount; i++) {
      const x = b.x + (i / (columnCount - 1) - 0.5) * (b.width - 2);
      const z = b.z + side * (b.depth / 2 - 0.8);
      column(builder, m, x, z, b.base, b.height, b.width * 0.016);
    }
    builder.box(
      m.jade,
      [b.x, b.base + b.height - 0.2, b.z + side * (b.depth / 2 - 0.8)],
      [b.width, 0.7, 0.55],
    );
    builder.box(
      m.gold,
      [b.x, b.base + b.height + 0.25, b.z + side * (b.depth / 2 - 0.8)],
      [b.width + 0.2, 0.15, 0.65],
    );
  }
  roof(
    builder,
    m,
    {
      ...b,
      width: b.width + 5,
      depth: b.depth + 5,
      base: b.base + b.height + 0.55,
      height: b.width * 0.17,
    },
    detailed,
  );
}

function lattice(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  width: number,
  height: number,
  base: number,
): void {
  builder.box(m.dark, [x, base + height / 2, z - 0.1], [width, height, 0.16]);
  for (let col = 0; col <= width / 0.65; col++)
    builder.box(
      m.goldDark,
      [x - width / 2 + col * 0.65, base + height / 2, z],
      [0.075, height, 0.12],
    );
  for (let row = 0; row <= height / 0.65; row++)
    builder.box(m.goldDark, [x, base + row * 0.65, z], [width, 0.075, 0.12]);
}

function hall(builder: LandBuilder, m: PureLandMaterials, plaque: Material): void {
  const h = PURE_LAND.hall;
  const base = 3.2;
  for (let tier = 0; tier < 3; tier++) {
    builder.box(m.stone, [0, tier * 0.9 + 0.5, h.z], [56 - tier * 2, 0.95, 44 - tier * 2]);
    builder.box(m.goldDark, [0, tier * 0.9 + 0.96, h.z], [56.1 - tier * 2, 0.1, 44.1 - tier * 2]);
  }
  for (let step = 0; step < 12; step++) {
    builder.box(m.stone, [0, 1.2 + (step / 12) * 2 - 0.12, -23 - step * 0.8], [18, 0.28, 0.85]);
  }
  pavilion(builder, m, { ...h, base }, true);
  // 上层檐下留出带状格窗，明暗交替让重檐的悬挑关系可读。
  builder.box(m.jade, [0, 21, h.z], [31, 4, 18]);
  lattice(builder, m, 0, h.z + 9.1, 29, 2.5, 20);
  roof(builder, m, { x: 0, z: h.z, width: 38, depth: 25, base: 23, height: 6 });
  roof(builder, m, { x: 0, z: h.z, width: 25, depth: 17, base: 29, height: 5 });
  builder.cylinder(m.goldDark, [0, 34.5, h.z], 0.7, 1.1);
  builder.sphere(m.gold, [0, 35.4, h.z], [0.8, 1, 0.8]);
  builder.cylinder(m.gold, [0, 37, h.z], 0.13, 2.4);
  const board = new PlaneGeometry(10, 2.5);
  builder.shape(board, plaque, [0, 15, h.z + h.depth / 2 + 0.15]);
  board.dispose();
  lattice(builder, m, -16.2, h.z + h.depth / 2 - 0.6, 7.8, 8, base + 1);
  lattice(builder, m, 16.2, h.z + h.depth / 2 - 0.6, 7.8, 8, base + 1);
  builder.box(m.dark, [0, 9.7, h.z - 11.8], [40, 13, 0.5]);
  for (const side of [-1, 1]) {
    railing(builder, m, [side * 27, -71], [side * 27, -32], 3.2);
    railing(builder, m, [side * 10, -31], [side * 27, -31], 3.2);
  }
}

function pagoda(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  scale: number,
  levels = 5,
): void {
  const base = 1.2;
  builder.cylinder(m.stone, [x, base, z], 5.5 * scale, 1.6);
  for (let i = 0; i < levels; i++) {
    const width = (8.8 - i * 0.9) * scale,
      y = base + i * 5.5 * scale;
    builder.box(m.jade, [x, y + 2 * scale, z], [width * 0.7, 4 * scale, width * 0.7]);
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) {
        builder.cylinder(
          m.gold,
          [x + dx * width * 0.34, y + 2 * scale, z + dz * width * 0.34],
          0.17 * scale,
          4 * scale,
        );
      }
    roof(
      builder,
      m,
      {
        x,
        z,
        width: width + scale * 3,
        depth: width + scale * 3,
        base: y + 4 * scale,
        height: 2.2 * scale,
      },
      false,
    );
  }
  const top = base + levels * 5.5 * scale + scale;
  builder.cylinder(m.gold, [x, top + 1.5 * scale, z], 0.14 * scale, 3 * scale);
  builder.sphere(m.gold, [x, top + 2.7 * scale, z], [0.45 * scale, 0.6 * scale, 0.45 * scale]);
}

export function createArchitecture(
  builder: LandBuilder,
  m: PureLandMaterials,
  plaque: Material,
): void {
  for (const path of PURE_LAND.paths) {
    const width = path.maxX - path.minX,
      depth = path.maxZ - path.minZ;
    const x = (path.minX + path.maxX) / 2,
      z = (path.minZ + path.maxZ) / 2;
    builder.box(m.stone, [x, 0.3, z], [width, 1.8, depth]);
    builder.box(m.goldDark, [x, 1.12, z], [width + 0.12, 0.12, depth + 0.12]);
    builder.box(m.stone, [x, 1.21, z], [width - 0.25, 0.08, depth - 0.25]);
  }
  // 中轴铺装：嵌金的琉璃青块面与小比例白石砖缝，提供真实尺度参照。
  for (let z = -18; z <= 102; z += 4) {
    builder.box(m.jade, [0, 1.27, z], [8, 0.04, 3.8]);
    builder.box(m.gold, [0, 1.3, z - 1.9], [8, 0.035, 0.055]);
    for (const side of [-1, 1]) builder.box(m.gold, [side * 4, 1.31, z], [0.045, 0.03, 3.8]);
  }
  for (const side of [-1, 1]) {
    railing(builder, m, [side * 7, -18], [side * 7, 73]);
    railing(builder, m, [side * 9, 75], [side * 56, 75]);
    railing(builder, m, [side * 9, -19], [side * 56, -19]);
    railing(builder, m, [side * 57, -18], [side * 57, 73]);
    railing(builder, m, [side * 69, -75], [side * 69, 73]);
    pavilion(builder, m, { x: side * 63, z: -53, width: 19, depth: 17, base: 1.5, height: 7.2 });
    roof(builder, m, { x: side * 63, z: -53, width: 17, depth: 15, base: 13, height: 3.6 });
    pavilion(builder, m, { x: side * 63, z: 50, width: 13, depth: 11, base: 1.5, height: 5.8 });
    pagoda(builder, m, side * 88, -90, 0.85);
    pagoda(builder, m, side * 98, 18, 0.62, 4);
    // 两侧开放回廊：每个开间能看到池水，而非封闭实体墙。
    for (let bay = 0; bay < 6; bay++) {
      const z = -25 + bay * 12;
      column(builder, m, side * 67, z, 1.2, 4.6, 0.24);
      column(builder, m, side * 59, z, 1.2, 4.6, 0.24);
    }
    roof(builder, m, { x: side * 63, z: 3, width: 12, depth: 70, base: 6.5, height: 2.8 }, false);
    for (let i = 0; i < 6; i++) {
      const x = side * (55 + i * 32),
        z = -160 - (i % 3) * 30;
      pavilion(builder, m, { x, z, width: 18, depth: 14, base: 0.8, height: 7 }, false);
      if (i % 2 === 0) pagoda(builder, m, x + side * 10, z - 30, 0.65, 4);
    }
  }
  hall(builder, m, plaque);
}
