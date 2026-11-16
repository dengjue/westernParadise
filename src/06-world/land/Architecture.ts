import { ExtrudeGeometry, LatheGeometry, PlaneGeometry, Shape, Vector2 } from 'three';
import type { Material } from 'three';
import type { PureLandMaterials } from '@/05-materials';
import {
  buildingColumns,
  LAND_CORRIDOR_COLUMNS,
  LAND_RAILINGS,
  LAND_ATMOSPHERE,
  LAND_CRAFT,
  LAND_DETAIL,
  LAND_STRUCTURE,
  PURE_LAND,
} from '@/01-shared';
import type { LandBuilding, LandDetail } from '@/01-shared';
import type { LandBuilder } from './Builder';
import { chamferedBox } from './CraftGeometry';
import { createRoofSteps } from './Roof';

type Building = LandBuilding;

function consume(steps: Generator<void, void, void>): void {
  while (!steps.next().done) {
    // The synchronous path consumes the same deterministic work units immediately.
  }
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

function* columnSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  base: number,
  height: number,
  radius: number,
  detail: LandDetail,
  contactY = base,
): Generator<void, void, void> {
  const craft = LAND_CRAFT.column;
  builder.contacts.push({
    x,
    y: contactY,
    z,
    radius: radius * LAND_ATMOSPHERE.contact.radiusRatio,
  });
  const foot = chamferedBox(
    radius * craft.footWidthRatio,
    craft.footHeight,
    radius * craft.footWidthRatio,
    craft.bevel,
  );
  yield* builder.shapeOwnedSteps(foot, m.carvedStone, [x, base + craft.footHeight / 2, z]);
  const profile = new LatheGeometry(
    craft.profile.map(([r, y]) => new Vector2(r * radius, y)),
    LAND_DETAIL[detail].radialSegments,
  );
  yield* builder.shapeOwnedSteps(profile, m.carvedStone, [x, base, z]);
  builder.cylinder(m.goldDark, [x, base + 0.78, z], radius * 1.08, 0.12);
  yield;
  builder.cylinder(m.wood, [x, base + height / 2, z], radius, height);
  yield;
  for (const y of [0.85, height - 0.5]) {
    builder.cylinder(m.gold, [x, base + y, z], radius * 1.06, 0.18);
    yield;
  }
  for (let level = 0; level < craft.bracketLevels; level++) {
    const y = base + height - 0.4 + level * craft.bracketStep;
    builder.box(
      level === 1 ? m.jade : m.goldDark,
      [x, y, z],
      [radius * (3.8 + level), 0.22, radius * 1.4],
    );
    builder.box(m.gold, [x, y + 0.12, z], [radius * 1.3, 0.18, radius * (3 + level * 0.7)]);
    yield;
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
    yield;
  }
}

function* railingSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  from: readonly [number, number],
  to: readonly [number, number],
  base = 1.3,
): Generator<void, void, void> {
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
    yield;
  }
  for (const y of [0.24, 1.18]) {
    builder.rod(m.gold, [from[0], base + y, from[1]], [to[0], base + y, to[1]], 0.09);
    yield;
  }
}

export function railing(
  builder: LandBuilder,
  m: PureLandMaterials,
  from: readonly [number, number],
  to: readonly [number, number],
  base = 1.3,
): void {
  consume(railingSteps(builder, m, from, to, base));
}

function* pavilionSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  b: Building,
  detail: LandDetail,
  floorIncluded = true,
): Generator<void, void, void> {
  const floor = LAND_CRAFT.floor,
    columns = LAND_STRUCTURE.columns;
  if (floorIncluded)
    builder.box(
      m.stone,
      [b.x, b.base - floor.footingThickness / 2, b.z],
      [b.width + 3, floor.footingThickness, b.depth + 3],
    );
  if (floorIncluded) yield;
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
      yield;
    }
  for (const side of [-1, 1]) {
    const columnCount = b.width > 30 ? columns.hallCount : columns.pavilionCount;
    for (const { x, z, radius, index: i } of buildingColumns(b).filter((c) => c.side === side)) {
      yield* columnSteps(builder, m, x, z, b.base, b.height, radius, detail);
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
        yield;
      }
    }
    builder.box(
      m.jade,
      [b.x, b.base + b.height - 0.2, b.z + side * (b.depth / 2 - 0.8)],
      [b.width, 0.7, 0.55],
    );
    yield;
    builder.box(
      m.gold,
      [b.x, b.base + b.height + 0.25, b.z + side * (b.depth / 2 - 0.8)],
      [b.width + 0.2, 0.15, 0.65],
    );
    yield;
  }
  yield* createRoofSteps(
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

function* latticeSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  width: number,
  height: number,
  base: number,
): Generator<void, void, void> {
  builder.box(m.dark, [x, base + height / 2, z - 0.1], [width, height, 0.16]);
  yield;
  for (let col = 0; col <= width / 0.65; col++) {
    builder.box(
      m.goldDark,
      [x - width / 2 + col * 0.65, base + height / 2, z],
      [0.075, height, 0.12],
    );
    yield;
  }
  for (let row = 0; row <= height / 0.65; row++) {
    builder.box(m.goldDark, [x, base + row * 0.65, z], [width, 0.075, 0.12]);
    yield;
  }
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
    yield;
  }
  for (const y of [base - 0.12, base + height + 0.12]) {
    builder.box(m.wood, [x, y, z - 0.04], [width + 0.45, 0.25, 0.36]);
    yield;
  }
}

function* hallSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  plaque: Material,
  detail: LandDetail,
): Generator<void, void, void> {
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
    yield;
    for (const side of [-1, 1]) {
      builder.box(
        m.goldDark,
        [h.x + (side * width) / 2, top - LAND_CRAFT.floor.borderDrop, centerZ],
        [LAND_CRAFT.floor.borderWidth, LAND_CRAFT.floor.borderHeight, depth],
      );
      yield;
      builder.box(
        m.goldDark,
        [h.x, top - LAND_CRAFT.floor.borderDrop, centerZ + (side * depth) / 2],
        [width, LAND_CRAFT.floor.borderHeight, LAND_CRAFT.floor.borderWidth],
      );
      yield;
    }
  }
  const run = (stairs.frontZ - stairs.backZ) / stairs.count;
  const rise = (base - LAND_STRUCTURE.courtHeight) / stairs.count;
  // 每块台阶从庭院基面延伸到其踏步顶面，最后一级恰好与主殿平台接平。
  for (let step = 0; step < stairs.count; step++) {
    const height = (step + 1) * rise;
    const geometry = chamferedBox(stairs.width, height, run, stairs.bevel);
    yield* builder.shapeOwnedSteps(geometry, m.stone, [
      stairs.x,
      LAND_STRUCTURE.courtHeight + height / 2,
      stairs.frontZ - (step + 0.5) * run,
    ]);
  }
  yield* pavilionSteps(builder, m, { ...h, base }, detail, false);
  // 上层檐下留出带状格窗，明暗交替让重檐的悬挑关系可读。
  builder.box(m.jade, [0, 21, h.z], [31, 4, 18]);
  yield;
  yield* latticeSteps(builder, m, 0, h.z + 9.1, 29, 2.5, 20);
  yield* createRoofSteps(
    builder,
    m,
    { x: 0, z: h.z, width: 38, depth: 25, base: 23, height: 6 },
    detail,
  );
  yield* createRoofSteps(
    builder,
    m,
    { x: 0, z: h.z, width: 25, depth: 17, base: 29, height: 5 },
    detail,
  );
  builder.cylinder(m.goldDark, [0, 34.5, h.z], 0.7, 1.1);
  yield;
  builder.sphere(m.gold, [0, 35.4, h.z], [0.8, 1, 0.8]);
  yield;
  builder.cylinder(m.gold, [0, 37, h.z], 0.13, 2.4);
  yield;
  const board = new PlaneGeometry(10, 2.5);
  yield* builder.shapeOwnedSteps(board, plaque, [0, 15, h.z + h.depth / 2 + 0.15]);
  const { screens, backWall } = LAND_STRUCTURE;
  for (const side of [-1, 1])
    yield* latticeSteps(
      builder,
      m,
      side * screens.x,
      h.z + h.depth / 2 - screens.frontOffset,
      screens.width,
      8,
      base + 1,
    );
  builder.box(
    m.dark,
    [h.x, backWall.centerY, h.z + backWall.offsetZ],
    [backWall.width, backWall.height, backWall.depth],
  );
  yield;
}

function* pagodaSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  scale: number,
  levels = 5,
): Generator<void, void, void> {
  const base = 1.2;
  builder.cylinder(m.stone, [x, base, z], 5.5 * scale, 1.6);
  yield;
  for (let i = 0; i < levels; i++) {
    const width = (8.8 - i * 0.9) * scale,
      y = base + i * 5.5 * scale;
    builder.box(m.jade, [x, y + 2 * scale, z], [width * 0.7, 4 * scale, width * 0.7]);
    yield;
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) {
        builder.cylinder(
          m.gold,
          [x + dx * width * 0.34, y + 2 * scale, z + dz * width * 0.34],
          0.17 * scale,
          4 * scale,
        );
        yield;
      }
    yield* createRoofSteps(
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
  yield;
  builder.sphere(m.gold, [x, top + 2.7 * scale, z], [0.45 * scale, 0.6 * scale, 0.45 * scale]);
  yield;
}

export function* createArchitectureSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  plaque: Material,
  detail: LandDetail,
): Generator<void, void, void> {
  for (const path of PURE_LAND.paths) {
    if (path.height !== LAND_STRUCTURE.courtHeight) continue;
    const width = path.maxX - path.minX,
      depth = path.maxZ - path.minZ;
    const x = (path.minX + path.maxX) / 2,
      z = (path.minZ + path.maxZ) / 2;
    builder.box(m.stone, [x, 0.3, z], [width, 1.8, depth]);
    yield;
    builder.box(m.goldDark, [x, 1.12, z], [width + 0.12, 0.12, depth + 0.12]);
    yield;
    const floor = LAND_CRAFT.floor;
    builder.box(
      m.stone,
      [x, path.height + floor.courtPavingRise - floor.courtPavingThickness / 2, z],
      [width - 0.25, floor.courtPavingThickness, depth - 0.25],
    );
    yield;
  }
  // 中轴铺装：嵌金的琉璃青块面与小比例白石砖缝，提供真实尺度参照。
  for (let z = -18; z <= 102; z += 4) {
    builder.box(m.jade, [0, 1.27, z], [8, 0.04, 3.8]);
    yield;
    builder.box(m.gold, [0, 1.3, z - 1.9], [8, 0.035, 0.055]);
    yield;
    for (const side of [-1, 1]) {
      builder.box(m.gold, [side * 4, 1.31, z], [0.045, 0.03, 3.8]);
      yield;
    }
  }
  for (const rail of LAND_RAILINGS) yield* railingSteps(builder, m, rail.from, rail.to, rail.base);
  for (const side of [-1, 1]) {
    for (const building of LAND_STRUCTURE.pavilions)
      yield* pavilionSteps(
        builder,
        m,
        { x: side * LAND_STRUCTURE.corridor.x, ...building },
        detail,
      );
    yield* createRoofSteps(
      builder,
      m,
      { x: side * LAND_STRUCTURE.corridor.x, z: -53, width: 17, depth: 15, base: 13, height: 3.6 },
      detail,
    );
    yield* pagodaSteps(builder, m, side * 88, -90, 0.85);
    yield* pagodaSteps(builder, m, side * 98, 18, 0.62, 4);
    // 两侧开放回廊：每个开间能看到池水，而非封闭实体墙。
    const corridor = LAND_STRUCTURE.corridor;
    for (const { x, z, radius } of LAND_CORRIDOR_COLUMNS.filter((c) => c.x * side > 0)) {
      // 柱身自台基起，接触影须在铺装顶面上，不能被最后一层石板遮住。
      const contactY = LAND_STRUCTURE.courtHeight + LAND_CRAFT.floor.courtPavingRise;
      yield* columnSteps(
        builder,
        m,
        x,
        z,
        LAND_STRUCTURE.courtHeight,
        corridor.columnHeight,
        radius,
        'middle',
        contactY,
      );
    }
    yield* createRoofSteps(
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
      const offset = distant.offsets[i]!,
        scale = distant.scales[i]!;
      const x = side * (distant.startX + i * distant.spacingX + offset[0]),
        z = distant.startZ - (i % 3) * distant.spacingZ + offset[1];
      yield* pavilionSteps(
        builder,
        m,
        {
          x,
          z,
          width: 18 * scale,
          depth: 14 * scale,
          base: distant.bases[i]!,
          height: distant.heights[i]!,
        },
        'far',
      );
      if (i % 2 === 0) yield* pagodaSteps(builder, m, x + side * 10, z - 30, 0.65, 4);
    }
  }
  yield* hallSteps(builder, m, plaque, detail);
}

/** 同步基线路径消费完整的确定性构建步骤。 */
export function createArchitecture(
  builder: LandBuilder,
  m: PureLandMaterials,
  plaque: Material,
  detail: LandDetail,
): void {
  consume(createArchitectureSteps(builder, m, plaque, detail));
}
