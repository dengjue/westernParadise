import { Group } from 'three';
import { LAND_RENDER, LAND_WORLD } from '@/01-shared';
import { LandCellQueue, prioritizeLandCells } from '@/02-core';
import type { LandCellCameraPose, LandCellCandidate, LandCellQueueSnapshot } from '@/02-core';
import type { PureLandMaterials } from '@/05-materials';
import { createEastRegionCellPayload } from './RegionPrototype';
import type { EastRegionCellPayload } from './RegionPrototype';

/** 原型观测值；距离/并发/驻留上限不是最终设备预算。 */
export interface EastRegionCellStreamSnapshot {
  readonly desired: number;
  readonly mounted: number;
  readonly queue: LandCellQueueSnapshot;
}

export interface EastRegionCellStream {
  /** deltaMs 驱动低频 reconcile；null 姿态立即回收此前驻留的东区 cell。 */
  update(pose: LandCellCameraPose | null, deltaMs: number): void;
  snapshot(): EastRegionCellStreamSnapshot;
  dispose(): void;
}

const RECONCILE_INTERVAL_MS = 120;
const MAX_CONCURRENT = 2;
const MAX_PENDING = 14;
const MAX_CELLS = MAX_CONCURRENT + MAX_PENDING;

/**
 * 第三人称东区原型调度器：队列拥有 cell payload，有限需求由姿态规划；
 * cell factory 仍在主线程执行，本模块不宣称 worker/GPU 异步构建。
 */
export function createEastRegionCellStream(
  parent: Group,
  materials: PureLandMaterials,
  cellSize: number = LAND_WORLD.cellSize,
): EastRegionCellStream {
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
  parent.add(regionRoot);

  const minColumn = Math.floor((region.bounds.minX - LAND_WORLD.cellOrigin.x) / cellSize);
  const maxColumn = Math.ceil((region.bounds.maxX - LAND_WORLD.cellOrigin.x) / cellSize);
  const minRow = Math.floor((region.bounds.minZ - LAND_WORLD.cellOrigin.z) / cellSize);
  const maxRow = Math.ceil((region.bounds.maxZ - LAND_WORLD.cellOrigin.z) / cellSize);
  const candidates: LandCellCandidate[] = [];
  const cells = new Map<string, { readonly column: number; readonly row: number }>();
  for (let column = minColumn; column < maxColumn; column++) {
    for (let row = minRow; row < maxRow; row++) {
      const key = `${column},${row}`;
      const cell = { column, row };
      candidates.push({
        key,
        centerX: LAND_WORLD.cellOrigin.x + (column + 0.5) * cellSize,
        centerZ: LAND_WORLD.cellOrigin.z + (row + 0.5) * cellSize,
      });
      cells.set(key, cell);
    }
  }

  const queue = new LandCellQueue<EastRegionCellPayload>({
    maxConcurrent: MAX_CONCURRENT,
    maxPending: MAX_PENDING,
    dispose: (payload) => payload.dispose(),
  });
  let desiredKeys = new Set<string>();
  let reconcileElapsedMs = RECONCILE_INTERVAL_MS;
  let disposed = false;

  const unloadUndesired = (nextKeys: ReadonlySet<string>): void => {
    for (const key of desiredKeys) if (!nextKeys.has(key)) queue.unload(key);
    desiredKeys = new Set(nextKeys);
  };

  return {
    update(pose, deltaMs): void {
      if (disposed) return;
      if (!pose) {
        if (desiredKeys.size > 0) unloadUndesired(new Set());
        return;
      }

      reconcileElapsedMs += Math.max(0, deltaMs);
      if (reconcileElapsedMs < RECONCILE_INTERVAL_MS) return;
      reconcileElapsedMs %= RECONCILE_INTERVAL_MS;

      const plan = prioritizeLandCells(candidates, pose, {
        activeRadius: cellSize * 1.5,
        prefetchRadius: cellSize * 3,
        minimumForwardDot: 0.1,
        frontBias: cellSize * 0.75,
        maxCells: MAX_CELLS,
      });
      const nextKeys = new Set(plan.map(({ key }) => key));
      unloadUndesired(nextKeys);

      const snapshot = queue.snapshot();
      let available = MAX_CONCURRENT + MAX_PENDING - snapshot.active - snapshot.queued;
      for (const item of plan) {
        if (queue.state(item.key) !== null) continue;
        if (available <= 0) break;
        const coordinates = cells.get(item.key);
        if (!coordinates) continue;
        available--;
        void queue
          .request(item.key, item.priority, (signal) => {
            if (signal.aborted) throw new Error(`cell ${item.key} 加载已取消`);
            return createEastRegionCellPayload(coordinates, materials, cellSize);
          })
          .then(
            (payload) => {
              if (
                payload &&
                !disposed &&
                desiredKeys.has(item.key) &&
                queue.state(item.key) === 'ready'
              )
                regionRoot.add(payload.root);
            },
            () => {
              // queue 保留 error 状态供 snapshot 观察；离开需求集后才允许重试。
            },
          );
      }
    },

    snapshot(): EastRegionCellStreamSnapshot {
      return {
        desired: desiredKeys.size,
        mounted: regionRoot.children.length,
        queue: queue.snapshot(),
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      desiredKeys.clear();
      regionRoot.removeFromParent();
      try {
        queue.dispose();
      } finally {
        regionRoot.clear();
      }
    },
  };
}
