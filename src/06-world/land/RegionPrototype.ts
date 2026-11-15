import { CircleGeometry, Group, Mesh, TorusGeometry } from 'three';
import { LAND_CRAFT, LAND_REGION_SURFACE_HEIGHT, LAND_RENDER, LAND_WORLD } from '@/01-shared';
import type { PureLandMaterials } from '@/05-materials';
import { LandBuilder } from './Builder';

/** 生成仅供 ?cam=third 验证的东侧水院：分 cell 地面、连续铺装、莲池、步桥与观景台。 */
export function createEastRegionPrototype(
  parent: Group,
  materials: PureLandMaterials,
  cellSize: number = LAND_WORLD.cellSize,
): void {
  const { east } = LAND_WORLD.prototype;
  const region = LAND_WORLD.regions.find(({ id }) => id === 'east-water-court');
  if (!region) throw new Error('缺少东侧水院分区定义');
  if (
    !LAND_RENDER.cellCandidates.includes(cellSize as (typeof LAND_RENDER.cellCandidates)[number]) ||
    LAND_WORLD.regionSize % cellSize !== 0
  )
    throw new RangeError(`东侧原型 cellSize 必须是有效候选值：${cellSize}`);
  const { bounds } = region;
  const root = new Group();
  root.name = 'region-prototype-east-water-court';
  root.userData['regionId'] = region.id;
  root.userData['cellSize'] = cellSize;
  const builder = new LandBuilder({
    cellSize,
    cellOrigin: [LAND_WORLD.cellOrigin.x, LAND_WORLD.cellOrigin.z],
  });
  const groundTop = east.groundHeight;

  // 一块区域表面拆为 5×5 个完整网格块，cell 边界与世界统一原点精确对齐。
  for (let x = bounds.minX; x < bounds.maxX; x += cellSize) {
    for (let z = bounds.minZ; z < bounds.maxZ; z += cellSize) {
      builder.box(
        materials.dark,
        [x + cellSize / 2, groundTop - east.groundThickness / 2, z + cellSize / 2],
        [cellSize, east.groundThickness, cellSize],
      );
    }
  }

  // 与现有南侧横向游线同宽同高；按 cell 切分，首段在区界前与旧铺装重叠。
  const route = east.route;
  const paving = LAND_CRAFT.floor.courtPavingThickness;
  let cursor: number = route.minX;
  while (cursor < route.maxX) {
    const column = Math.floor((cursor - LAND_WORLD.cellOrigin.x) / cellSize);
    const cellEnd = LAND_WORLD.cellOrigin.x + (column + 1) * cellSize;
    const segmentEnd = Math.min(route.maxX, cellEnd);
    builder.box(
      materials.stone,
      [
        (cursor + segmentEnd) / 2,
        LAND_REGION_SURFACE_HEIGHT - paving / 2,
        (route.minZ + route.maxZ) / 2,
      ],
      [segmentEnd - cursor, paving, route.maxZ - route.minZ],
    );
    for (const edge of [-1, 1] as const) {
      builder.box(
        materials.goldDark,
        [
          (cursor + segmentEnd) / 2,
          LAND_REGION_SURFACE_HEIGHT + 0.045,
          edge < 0 ? route.minZ + 0.25 : route.maxZ - 0.25,
        ],
        [segmentEnd - cursor, 0.07, 0.12],
      );
    }
    cursor = segmentEnd;
  }

  // 外缘用低矮石栏提示灰盒边界；西侧留空，确保与中心区门户连通。
  const boundary = east.boundary;
  const boundaryY = groundTop + boundary.height / 2;
  builder.box(
    materials.carvedStone,
    [(bounds.minX + bounds.maxX) / 2, boundaryY, bounds.minZ + boundary.thickness / 2],
    [bounds.maxX - bounds.minX, boundary.height, boundary.thickness],
  );
  builder.box(
    materials.carvedStone,
    [(bounds.minX + bounds.maxX) / 2, boundaryY, bounds.maxZ - boundary.thickness / 2],
    [bounds.maxX - bounds.minX, boundary.height, boundary.thickness],
  );
  builder.box(
    materials.carvedStone,
    [bounds.maxX - boundary.thickness / 2, boundaryY, (bounds.minZ + bounds.maxZ) / 2],
    [boundary.thickness, boundary.height, bounds.maxZ - bounds.minZ],
  );

  const { pond } = east;
  const water = new Mesh(new CircleGeometry(pond.radius, 48), materials.jade);
  water.rotation.x = -Math.PI / 2;
  water.position.set(pond.x, groundTop + 0.035, pond.z);
  water.name = 'region-prototype-east-pond';
  water.receiveShadow = true;
  water.layers.enable(LAND_RENDER.layers.reflection);
  water.userData['cell'] =
    `${Math.floor((pond.x - LAND_WORLD.cellOrigin.x) / cellSize)},${Math.floor((pond.z - LAND_WORLD.cellOrigin.z) / cellSize)}`;
  water.geometry.computeBoundingBox();
  water.geometry.computeBoundingSphere();
  root.add(water);

  const shore = new Mesh(new TorusGeometry(pond.radius, 1.15, 8, 64), materials.carvedStone);
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(pond.x, groundTop + 0.06, pond.z);
  shore.name = 'region-prototype-east-pond-shore';
  shore.receiveShadow = true;
  shore.layers.enable(LAND_RENDER.layers.reflection);
  root.add(shore);

  // 简化步桥完整归入中心 cell，不沿池面切开；导航高度由同一 bridge 配置采样。
  const bridge = pond.bridge;
  const bridgeCenterZ = (bridge.minZ + bridge.maxZ) / 2;
  const bridgeLength = bridge.maxZ - bridge.minZ;
  const bridgeHeight = LAND_REGION_SURFACE_HEIGHT + bridge.rise;
  const bridgeDeckThickness = LAND_CRAFT.floor.courtPavingThickness * 1.5;
  builder.box(
    materials.stone,
    [bridge.centerX, bridgeHeight - bridgeDeckThickness / 2, bridgeCenterZ],
    [bridge.width, bridgeDeckThickness, bridgeLength],
  );
  for (const side of [-1, 1] as const) {
    builder.box(
      materials.goldDark,
      [
        bridge.centerX + side * (bridge.width / 2 - 0.18),
        bridgeHeight + bridge.railHeight / 2,
        bridgeCenterZ,
      ],
      [0.24, bridge.railHeight, bridgeLength],
    );
  }

  // 四柱观景台提供可从主路辨认的尺度参照，不引入可交互或任务语义。
  const landmark = east.landmark;
  const halfSpan = landmark.span / 2;
  for (const xSide of [-1, 1] as const)
    for (const zSide of [-1, 1] as const)
      builder.box(
        materials.carvedStone,
        [
          landmark.x + xSide * halfSpan,
          groundTop + landmark.pillarHeight / 2,
          landmark.z + zSide * halfSpan,
        ],
        [landmark.pillarSize, landmark.pillarHeight, landmark.pillarSize],
      );
  builder.box(
    materials.jade,
    [landmark.x, groundTop + landmark.pillarHeight, landmark.z],
    [landmark.span + 1.2, 0.45, landmark.span + 1.2],
  );
  builder.box(
    materials.gold,
    [landmark.x, groundTop + landmark.pillarHeight + landmark.roofHeight / 2, landmark.z],
    [landmark.span + 2.4, landmark.roofHeight, landmark.span + 2.4],
  );
  builder.flush(root);
  parent.add(root);
}
