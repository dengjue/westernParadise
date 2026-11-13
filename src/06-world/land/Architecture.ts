import { ExtrudeGeometry, LatheGeometry, PlaneGeometry, Shape, Vector2 } from 'three';
import type { Material } from 'three';
import type { PureLandMaterials } from '@/05-materials';
import { LAND_CRAFT, LAND_DETAIL, LAND_STRUCTURE, PURE_LAND } from '@/01-shared';
import type { LandDetail } from '@/01-shared';
import type { LandBuilder } from './Builder';
import { chamferedBox } from './CraftGeometry';
import { createRoof as roof } from './Roof';

interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  height: number;
}

/** 雀替轮廓从柱头承接梁枋，使用薄挤出曲面而不是悬空方块。 */
function corbel(width: number, height: number, depth: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, height);
  shape.lineTo(width, height);
  shape.bezierCurveTo(
    width,
    height * 0.55,
    width * 0.64,
    height * 0.72,
    width * 0.56,
    height * 0.46,
  );
  shape.bezierCurveTo(width * 0.4, height * 0.16, width * 0.13, height * 0.3, 0, 0);
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function column(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  base: number,
  height: number,
  radius: number,
  detail: LandDetail,
): void {
  const craft = LAND_CRAFT.column;
  const foot = chamferedBox(
    radius * craft.footWidthRatio,
    craft.footHeight,
    radius * craft.footWidthRatio,
    craft.bevel,
  );
  builder.shape(foot, m.carvedStone, [x, base + craft.footHeight / 2, z]);
  foot.dispose();
  const profile = new LatheGeometry(
    craft.profile.map(([r, y]) => new Vector2(r * radius, y)),
    LAND_DETAIL[detail].radialSegments,
  );
  builder.shape(profile, m.carvedStone, [x, base, z]);
  profile.dispose();
  builder.cylinder(m.goldDark, [x, base + 0.78, z], radius * 1.08, 0.12);
  builder.cylinder(m.wood, [x, base + height / 2, z], radius, height);
  for (const y of [0.85, height - 0.5])
    builder.cylinder(m.gold, [x, base + y, z], radius * 1.06, 0.18);
  for (let level = 0; level < craft.bracketLevels; level++) {
    const y = base + height - 0.4 + level * craft.bracketStep;
    builder.box(
      level === 1 ? m.jade : m.goldDark,
      [x, y, z],
      [radius * (3.8 + level), 0.22, radius * 1.4],
    );
    builder.box(m.gold, [x, y + 0.12, z], [radius * 1.3, 0.18, radius * (3 + level * 0.7)]);
  }
  if (LAND_DETAIL[detail].ornaments) {
    const bracket = corbel(radius * craft.corbelWidthRatio, craft.corbelHeight, craft.corbelDepth);
    for (const side of [-1, 1])
      builder.shape(
        bracket,
        m.goldDark,
        [x + side * radius, base + height - craft.corbelHeight - 0.6, z],
        [1, 1, 1],
        side < 0 ? Math.PI : 0,
      );
    bracket.dispose();
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

function pavilion(
  builder: LandBuilder,
  m: PureLandMaterials,
  b: Building,
  detail: LandDetail,
  floorIncluded = true,
): void {
  const floor = LAND_CRAFT.floor,
    columns = LAND_STRUCTURE.columns;
  if (floorIncluded)
    builder.box(
      m.stone,
      [b.x, b.base - floor.footingThickness / 2, b.z],
      [b.width + 3, floor.footingThickness, b.depth + 3],
    );
  // 压边只放在台基侧面并低于顶面，修复原金属整片与石地面共面的闪烁。
  if (floorIncluded)
    for (const side of [-1, 1]) {
      builder.box(
        m.goldDark,
        [b.x, b.base - floor.borderDrop, b.z + (side * (b.depth + 3)) / 2],
        [b.width + 3, floor.borderHeight, floor.borderWidth],
      );
      builder.box(
        m.goldDark,
        [b.x + (side * (b.width + 3)) / 2, b.base - floor.borderDrop, b.z],
        [floor.borderWidth, floor.borderHeight, b.depth + 3],
      );
    }
  for (const side of [-1, 1]) {
    const columnCount = b.width > 30 ? columns.hallCount : columns.pavilionCount;
    for (let i = 0; i < columnCount; i++) {
      const x = b.x + (i / (columnCount - 1) - 0.5) * (b.width - columns.insetX * 2);
      const z = b.z + side * (b.depth / 2 - columns.insetZ);
      column(builder, m, x, z, b.base, b.height, b.width * columns.radiusRatio, detail);
      if (i < columnCount - 1 && LAND_DETAIL[detail].ornaments) {
        const bay = (b.width - columns.insetX * 2) / (columnCount - 1);
        const panel = new PlaneGeometry(bay - 1.2, 0.54);
        builder.shape(
          panel,
          m.frieze,
          [x + bay / 2, b.base + b.height - 0.2, z + side * 0.281],
          [1, 1, 1],
          side > 0 ? 0 : Math.PI,
        );
        panel.dispose();
      }
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
    detail,
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
  for (const side of [-1, 1]) {
    builder.box(
      m.wood,
      [x + side * (width / 2 + 0.1), base + height / 2, z - 0.04],
      [0.25, height + 0.45, 0.36],
    );
    builder.box(
      m.gold,
      [x + side * (width / 2 - 0.04), base + height / 2, z + 0.12],
      [0.04, height, 0.05],
    );
  }
  for (const y of [base - 0.12, base + height + 0.12])
    builder.box(m.wood, [x, y, z - 0.04], [width + 0.45, 0.25, 0.36]);
}

function hall(
  builder: LandBuilder,
  m: PureLandMaterials,
  plaque: Material,
  detail: LandDetail,
): void {
  const h = PURE_LAND.hall;
  const base = h.base;
  const stairs = LAND_STRUCTURE.stairs;
  const terrace = LAND_STRUCTURE.terrace;
  const terraceDepth = stairs.backZ - terrace.backZ;
  const centerZ = (stairs.backZ + terrace.backZ) / 2;
  const tierHeight = base / terrace.tiers;
  // 顶层完整延伸到阶道后缘；正殿不再叠一块同高地板，消除共面闪烁与隐形落差。
  for (let tier = 0; tier < terrace.tiers; tier++) {
    const overhang = (terrace.tiers - tier - 1) * terrace.tierOverhang;
    const width = terrace.halfWidth * 2 + overhang * 2,
      depth = terraceDepth + overhang * 2;
    const top = (tier + 1) * tierHeight;
    builder.box(m.stone, [h.x, top - tierHeight / 2, centerZ], [width, tierHeight, depth]);
    for (const side of [-1, 1]) {
      builder.box(
        m.goldDark,
        [h.x + (side * width) / 2, top - LAND_CRAFT.floor.borderDrop, centerZ],
        [LAND_CRAFT.floor.borderWidth, LAND_CRAFT.floor.borderHeight, depth],
      );
      builder.box(
        m.goldDark,
        [h.x, top - LAND_CRAFT.floor.borderDrop, centerZ + (side * depth) / 2],
        [width, LAND_CRAFT.floor.borderHeight, LAND_CRAFT.floor.borderWidth],
      );
    }
  }
  const run = (stairs.frontZ - stairs.backZ) / stairs.count;
  const rise = (base - LAND_STRUCTURE.courtHeight) / stairs.count;
  // 每块台阶从庭院基面延伸到其踏步顶面，最后一级恰好与主殿平台接平。
  for (let step = 0; step < stairs.count; step++) {
    const height = (step + 1) * rise;
    const geometry = chamferedBox(stairs.width, height, run, stairs.bevel);
    builder.shape(geometry, m.stone, [
      stairs.x,
      LAND_STRUCTURE.courtHeight + height / 2,
      stairs.frontZ - (step + 0.5) * run,
    ]);
    geometry.dispose();
  }
  pavilion(builder, m, { ...h, base }, detail, false);
  // 上层檐下留出带状格窗，明暗交替让重檐的悬挑关系可读。
  builder.box(m.jade, [0, 21, h.z], [31, 4, 18]);
  lattice(builder, m, 0, h.z + 9.1, 29, 2.5, 20);
  roof(builder, m, { x: 0, z: h.z, width: 38, depth: 25, base: 23, height: 6 }, detail);
  roof(builder, m, { x: 0, z: h.z, width: 25, depth: 17, base: 29, height: 5 }, detail);
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
    railing(
      builder,
      m,
      [side * (terrace.halfWidth - 1), terrace.backZ + 3],
      [side * (terrace.halfWidth - 1), stairs.backZ - 0.5],
      base,
    );
    railing(
      builder,
      m,
      [side * (stairs.width / 2 + 1), stairs.backZ - 0.5],
      [side * (terrace.halfWidth - 1), stairs.backZ - 0.5],
      base,
    );
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
      'far',
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
  detail: LandDetail,
): void {
  for (const path of PURE_LAND.paths) {
    if (path.height !== LAND_STRUCTURE.courtHeight) continue;
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
    for (const building of LAND_STRUCTURE.pavilions)
      pavilion(builder, m, { x: side * LAND_STRUCTURE.corridor.x, ...building }, detail);
    roof(
      builder,
      m,
      { x: side * LAND_STRUCTURE.corridor.x, z: -53, width: 17, depth: 15, base: 13, height: 3.6 },
      detail,
    );
    pagoda(builder, m, side * 88, -90, 0.85);
    pagoda(builder, m, side * 98, 18, 0.62, 4);
    // 两侧开放回廊：每个开间能看到池水，而非封闭实体墙。
    const corridor = LAND_STRUCTURE.corridor;
    for (let bay = 0; bay < corridor.bays; bay++) {
      const z = -25 + bay * corridor.spacing;
      column(builder, m, side * 67, z, LAND_STRUCTURE.courtHeight, 4.6, 0.24, 'middle');
      column(builder, m, side * 59, z, LAND_STRUCTURE.courtHeight, 4.6, 0.24, 'middle');
    }
    roof(
      builder,
      m,
      {
        x: side * corridor.x,
        z: 3,
        width: corridor.width,
        depth: corridor.depth,
        base: corridor.roofBase,
        height: corridor.roofRise,
      },
      'far',
    );
    const distant = LAND_STRUCTURE.distant;
    for (let i = 0; i < distant.count; i++) {
      const x = side * (distant.startX + i * distant.spacingX),
        z = distant.startZ - (i % 3) * distant.spacingZ;
      pavilion(builder, m, { x, z, width: 18, depth: 14, base: 0.8, height: 7 }, 'far');
      if (i % 2 === 0) pagoda(builder, m, x + side * 10, z - 30, 0.65, 4);
    }
  }
  hall(builder, m, plaque, detail);
}
