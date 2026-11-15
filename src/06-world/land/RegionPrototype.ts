import { CircleGeometry, Group, Mesh, TorusGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { LAND_CRAFT, LAND_REGION_SURFACE_HEIGHT, LAND_RENDER, LAND_WORLD } from '@/01-shared';
import { LandCellResourceScope } from '@/02-core';
import type { PureLandMaterials } from '@/05-materials';
import { LandBuilder } from './Builder';

export interface EastRegionCellCoordinates {
  readonly column: number;
  readonly row: number;
}

export interface EastRegionCellPayload {
  readonly key: string;
  readonly coordinates: EastRegionCellCoordinates;
  readonly root: Group;
  /** 从父组卸下并释放 cell 独占几何；共享材质仍归世界材质所有者管理。 */
  dispose(): void;
}

/** 独立构建东侧水院的一个 cell；payload 可直接交给有界队列管理。 */
export function createEastRegionCellPayload(
  coordinates: EastRegionCellCoordinates,
  materials: PureLandMaterials,
  cellSize: number = LAND_WORLD.cellSize,
): EastRegionCellPayload {
  const { east } = LAND_WORLD.prototype;
  const region = LAND_WORLD.regions.find(({ id }) => id === 'east-water-court');
  if (!region) throw new Error('缺少东侧水院分区定义');
  if (
    !LAND_RENDER.cellCandidates.includes(cellSize as (typeof LAND_RENDER.cellCandidates)[number]) ||
    LAND_WORLD.regionSize % cellSize !== 0
  )
    throw new RangeError(`东侧原型 cellSize 必须是有效候选值：${cellSize}`);

  const { bounds } = region;
  const { column, row } = coordinates;
  if (!Number.isInteger(column) || !Number.isInteger(row))
    throw new RangeError('东侧 cell 坐标必须是整数');
  const minColumn = Math.floor((bounds.minX - LAND_WORLD.cellOrigin.x) / cellSize);
  const maxColumn = Math.ceil((bounds.maxX - LAND_WORLD.cellOrigin.x) / cellSize);
  const minRow = Math.floor((bounds.minZ - LAND_WORLD.cellOrigin.z) / cellSize);
  const maxRow = Math.ceil((bounds.maxZ - LAND_WORLD.cellOrigin.z) / cellSize);
  if (column < minColumn || column >= maxColumn || row < minRow || row >= maxRow)
    throw new RangeError(`cell ${column},${row} 不属于东侧水院`);

  const key = `${column},${row}`;
  const root = new Group();
  root.name = `region-prototype-east-cell-${key}`;
  root.userData['regionId'] = region.id;
  root.userData['cellSize'] = cellSize;
  root.userData['cell'] = key;
  const scope = new LandCellResourceScope();
  const ownedGeometries = new Set<BufferGeometry>();
  const ownGeometry = <T extends BufferGeometry>(geometry: T): T => {
    if (!ownedGeometries.has(geometry)) {
      ownedGeometries.add(geometry);
      scope.own(geometry, (value) => value.dispose());
    }
    return geometry;
  };

  const cellMinX = LAND_WORLD.cellOrigin.x + column * cellSize;
  const cellMaxX = cellMinX + cellSize;
  const cellMinZ = LAND_WORLD.cellOrigin.z + row * cellSize;
  const cellMaxZ = cellMinZ + cellSize;
  const route = east.route;
  const contains = (x: number, z: number): boolean =>
    Math.floor((x - LAND_WORLD.cellOrigin.x) / cellSize) === column &&
    Math.floor((z - LAND_WORLD.cellOrigin.z) / cellSize) === row;
  const builder = new LandBuilder({
    cellSize,
    cellOrigin: [LAND_WORLD.cellOrigin.x, LAND_WORLD.cellOrigin.z],
  });
  const groundTop = east.groundHeight;

  try {
    // 每个 cell 只生成自己的地面网格。
    if (
      cellMinX >= bounds.minX &&
      cellMaxX <= bounds.maxX &&
      cellMinZ >= bounds.minZ &&
      cellMaxZ <= bounds.maxZ
    ) {
      const routeMinZ = Math.max(route.minZ, cellMinZ);
      const routeMaxZ = Math.min(route.maxZ, cellMaxZ);
      const routeCoversCellX = cellMinX >= route.minX && cellMaxX <= route.maxX;
      const groundRanges =
        routeCoversCellX && routeMaxZ > routeMinZ
          ? [[cellMinZ, routeMinZ] as const, [routeMaxZ, cellMaxZ] as const]
          : [[cellMinZ, cellMaxZ] as const];
      for (const [groundMinZ, groundMaxZ] of groundRanges) {
        if (groundMaxZ <= groundMinZ) continue;
        builder.box(
          materials.dark,
          [
            cellMinX + cellSize / 2,
            groundTop - east.groundThickness / 2,
            (groundMinZ + groundMaxZ) / 2,
          ],
          [cellSize, east.groundThickness, groundMaxZ - groundMinZ],
        );
      }
    }

    // 路面沿 X 按 cell 边界切片，只把本格片段与边缘金线写入本 payload。
    if (contains((cellMinX + cellMaxX) / 2, (route.minZ + route.maxZ) / 2)) {
      const segmentStart = Math.max(route.minX, cellMinX);
      const segmentEnd = Math.min(route.maxX, cellMaxX);
      if (segmentEnd > segmentStart) {
        const paving = LAND_CRAFT.floor.courtPavingThickness;
        const centerX = (segmentStart + segmentEnd) / 2;
        builder.box(
          materials.stone,
          [centerX, LAND_REGION_SURFACE_HEIGHT - paving / 2, (route.minZ + route.maxZ) / 2],
          [segmentEnd - segmentStart, paving, route.maxZ - route.minZ],
        );
        for (const edge of [-1, 1] as const) {
          builder.box(
            materials.goldDark,
            [
              centerX,
              LAND_REGION_SURFACE_HEIGHT + 0.045,
              edge < 0 ? route.minZ + 0.25 : route.maxZ - 0.25,
            ],
            [segmentEnd - segmentStart, 0.07, 0.12],
          );
        }
      }
    }

    // 外缘栏杆按构件中心归属一个 cell，西侧保持门户畅通。
    const boundary = east.boundary;
    const boundaryY = groundTop + boundary.height / 2;
    const boundaryCenterX = (bounds.minX + bounds.maxX) / 2;
    const northCenterZ = bounds.minZ + boundary.thickness / 2;
    if (contains(boundaryCenterX, northCenterZ))
      builder.box(
        materials.carvedStone,
        [boundaryCenterX, boundaryY, northCenterZ],
        [bounds.maxX - bounds.minX, boundary.height, boundary.thickness],
      );
    const southCenterZ = bounds.maxZ - boundary.thickness / 2;
    if (contains(boundaryCenterX, southCenterZ))
      builder.box(
        materials.carvedStone,
        [boundaryCenterX, boundaryY, southCenterZ],
        [bounds.maxX - bounds.minX, boundary.height, boundary.thickness],
      );
    const eastCenterX = bounds.maxX - boundary.thickness / 2;
    const eastCenterZ = (bounds.minZ + bounds.maxZ) / 2;
    if (contains(eastCenterX, eastCenterZ))
      builder.box(
        materials.carvedStone,
        [eastCenterX, boundaryY, eastCenterZ],
        [boundary.thickness, boundary.height, bounds.maxZ - bounds.minZ],
      );

    const { pond } = east;
    if (contains(pond.x, pond.z)) {
      const waterGeometry = ownGeometry(new CircleGeometry(pond.radius, 48));
      const water = new Mesh(waterGeometry, materials.jade);
      water.rotation.x = -Math.PI / 2;
      water.position.set(pond.x, groundTop + 0.035, pond.z);
      water.name = 'region-prototype-east-pond';
      water.receiveShadow = true;
      water.layers.enable(LAND_RENDER.layers.reflection);
      water.userData['cell'] = key;
      water.geometry.computeBoundingBox();
      water.geometry.computeBoundingSphere();
      root.add(water);

      const shore = new Mesh(
        ownGeometry(new TorusGeometry(pond.radius, 1.15, 8, 64)),
        materials.carvedStone,
      );
      shore.rotation.x = -Math.PI / 2;
      shore.position.set(pond.x, groundTop + 0.06, pond.z);
      shore.name = 'region-prototype-east-pond-shore';
      shore.receiveShadow = true;
      shore.layers.enable(LAND_RENDER.layers.reflection);
      root.add(shore);

      // 简化步桥完整归入池心 cell，不沿池面切开。
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
    }

    // 四柱观景台作为整体归入其中心 cell。
    const landmark = east.landmark;
    if (contains(landmark.x, landmark.z)) {
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
    }

    builder.flush(root);
    root.traverse((object) => {
      if (object instanceof Mesh) ownGeometry(object.geometry);
    });
  } catch (error) {
    scope.dispose();
    root.clear();
    throw error;
  }

  let disposed = false;
  return {
    key,
    coordinates: { column, row },
    root,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      try {
        scope.dispose();
      } finally {
        root.clear();
      }
    },
  };
}

/**
 * 阶段 3 的静态展示适配器：一次装配全部东区 cell，但每格已有独立资源所有权边界。
 * 返回值供 world 生命周期统一释放；后续运行时调度可直接改为按需调用 cell factory。
 */
export function createEastRegionPrototype(
  parent: Group,
  materials: PureLandMaterials,
  cellSize: number = LAND_WORLD.cellSize,
): () => void {
  const region = LAND_WORLD.regions.find(({ id }) => id === 'east-water-court');
  if (!region) throw new Error('缺少东侧水院分区定义');
  if (
    !LAND_RENDER.cellCandidates.includes(cellSize as (typeof LAND_RENDER.cellCandidates)[number]) ||
    LAND_WORLD.regionSize % cellSize !== 0
  )
    throw new RangeError(`东侧原型 cellSize 必须是有效候选值：${cellSize}`);

  const regionRoot = new Group();
  regionRoot.name = 'region-prototype-east-water-court';
  regionRoot.userData['regionId'] = region.id;
  regionRoot.userData['cellSize'] = cellSize;
  const cells: EastRegionCellPayload[] = [];
  const minColumn = Math.floor((region.bounds.minX - LAND_WORLD.cellOrigin.x) / cellSize);
  const maxColumn = Math.ceil((region.bounds.maxX - LAND_WORLD.cellOrigin.x) / cellSize);
  const minRow = Math.floor((region.bounds.minZ - LAND_WORLD.cellOrigin.z) / cellSize);
  const maxRow = Math.ceil((region.bounds.maxZ - LAND_WORLD.cellOrigin.z) / cellSize);

  try {
    for (let column = minColumn; column < maxColumn; column++)
      for (let row = minRow; row < maxRow; row++)
        cells.push(createEastRegionCellPayload({ column, row }, materials, cellSize));
  } catch (error) {
    disposePayloads(cells);
    throw error;
  }

  for (const cell of cells) regionRoot.add(cell.root);
  parent.add(regionRoot);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    disposePayloads(cells);
    regionRoot.removeFromParent();
    regionRoot.clear();
  };
}

function disposePayloads(payloads: readonly EastRegionCellPayload[]): void {
  let firstError: unknown;
  let failed = false;
  for (const payload of payloads) {
    try {
      payload.dispose();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}
