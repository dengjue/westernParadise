import type { WorldBounds } from '@/00-types';
import type { StaticColliders } from '../collision/StaticColliders';

export interface NavigationPoint {
  readonly x: number;
  readonly z: number;
}

export interface NavigationPoint3d extends NavigationPoint {
  readonly y: number;
}

export interface GridNavigatorOptions {
  readonly bounds: WorldBounds;
  readonly cellSize: number;
  readonly maxStepHeight: number;
  readonly maxSearchNodes: number;
  readonly colliders: StaticColliders;
}

export interface GridPath {
  readonly points: readonly NavigationPoint3d[];
  readonly distance: number;
  readonly visitedNodes: number;
}

interface Cell {
  readonly x: number;
  readonly z: number;
}

interface SearchRecord {
  readonly cell: Cell;
  readonly key: string;
  readonly g: number;
  readonly h: number;
  readonly parentKey: string | null;
}

const NEIGHBORS: readonly Cell[] = Object.freeze([
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 0, z: -1 }),
]);

/**
 * 轻量多层网格寻路：节点高度来自 StaticColliders 的地面采样，邻接边拒绝超过台阶阈值的高差。
 * 只用于 walktest 与后续导览路线，不进入渲染主循环，也不复制碰撞盒判断。
 */
export class GridNavigator {
  readonly cellSize: number;

  private readonly bounds: WorldBounds;
  private readonly maxStepHeight: number;
  private readonly maxSearchNodes: number;
  private readonly colliders: StaticColliders;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly columns: number;
  private readonly rows: number;

  constructor(options: GridNavigatorOptions) {
    if (options.cellSize <= 0) {
      throw new RangeError('寻路网格 cellSize 必须为正数');
    }
    if (options.maxStepHeight < 0 || options.maxSearchNodes <= 0) {
      throw new RangeError('寻路台阶高度和搜索节点上限必须合法');
    }
    this.bounds = options.bounds;
    this.cellSize = options.cellSize;
    this.maxStepHeight = options.maxStepHeight;
    this.maxSearchNodes = Math.floor(options.maxSearchNodes);
    this.colliders = options.colliders;
    this.columns = Math.max(
      1,
      Math.floor((options.bounds.maxX - options.bounds.minX) / this.cellSize),
    );
    this.rows = Math.max(
      1,
      Math.floor((options.bounds.maxZ - options.bounds.minZ) / this.cellSize),
    );
    this.minX = options.bounds.minX + this.cellSize / 2;
    this.minZ = options.bounds.minZ + this.cellSize / 2;
  }

  findPath(start: NavigationPoint, target: NavigationPoint): GridPath | null {
    if (!this.inBounds(start) || !this.inBounds(target)) {
      return null;
    }
    const startCell = this.toCell(start);
    const targetCell = this.toCell(target);
    const startPoint = this.toPoint(startCell);
    const targetPoint = this.toPoint(targetCell);
    if (!this.isWalkable(startPoint) || !this.isWalkable(targetPoint)) {
      return null;
    }

    const startKey = this.key(startCell);
    const targetKey = this.key(targetCell);
    const open: SearchRecord[] = [
      {
        cell: startCell,
        key: startKey,
        g: 0,
        h: this.heuristic(startCell, targetCell),
        parentKey: null,
      },
    ];
    const records = new Map<string, SearchRecord>([[startKey, open[0]!]]);
    const closed = new Set<string>();
    let visitedNodes = 0;

    while (open.length > 0 && visitedNodes < this.maxSearchNodes) {
      const currentIndex = this.bestOpenIndex(open);
      const current = open.splice(currentIndex, 1)[0];
      if (current === undefined || closed.has(current.key)) {
        continue;
      }
      closed.add(current.key);
      visitedNodes += 1;

      if (current.key === targetKey) {
        return this.buildPath(current.key, records, visitedNodes);
      }

      const currentPoint = this.toPoint(current.cell);
      const currentHeight = this.colliders.sampleGroundHeight(currentPoint.x, currentPoint.z);
      for (const direction of NEIGHBORS) {
        const nextCell = {
          x: current.cell.x + direction.x,
          z: current.cell.z + direction.z,
        };
        if (!this.inGrid(nextCell)) {
          continue;
        }
        const nextKey = this.key(nextCell);
        if (closed.has(nextKey)) {
          continue;
        }
        const nextPoint = this.toPoint(nextCell);
        if (!this.isWalkable(nextPoint)) {
          continue;
        }
        const nextHeight = this.colliders.sampleGroundHeight(nextPoint.x, nextPoint.z);
        if (Math.abs(nextHeight - currentHeight) > this.maxStepHeight) {
          continue;
        }

        const nextG = current.g + this.cellSize;
        const previous = records.get(nextKey);
        if (previous !== undefined && nextG >= previous.g) {
          continue;
        }
        const nextRecord: SearchRecord = {
          cell: nextCell,
          key: nextKey,
          g: nextG,
          h: this.heuristic(nextCell, targetCell),
          parentKey: current.key,
        };
        records.set(nextKey, nextRecord);
        open.push(nextRecord);
      }
    }
    return null;
  }

  private buildPath(
    targetKey: string,
    records: ReadonlyMap<string, SearchRecord>,
    visitedNodes: number,
  ): GridPath {
    const cells: Cell[] = [];
    let currentKey: string | null = targetKey;
    while (currentKey !== null) {
      const record = records.get(currentKey);
      if (record === undefined) {
        break;
      }
      cells.push(record.cell);
      currentKey = record.parentKey;
    }
    cells.reverse();
    const points = cells.map((cell) => {
      const point = this.toPoint(cell);
      return Object.freeze({
        x: point.x,
        y: this.colliders.sampleGroundHeight(point.x, point.z),
        z: point.z,
      });
    });
    return Object.freeze({
      points: Object.freeze(points),
      distance: Math.max(0, (points.length - 1) * this.cellSize),
      visitedNodes,
    });
  }

  private bestOpenIndex(open: readonly SearchRecord[]): number {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < open.length; index += 1) {
      const record = open[index];
      if (record === undefined) {
        continue;
      }
      const score = record.g + record.h;
      if (
        score < bestScore ||
        (score === bestScore && record.h < (open[bestIndex]?.h ?? bestScore))
      ) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private heuristic(from: Cell, to: Cell): number {
    return (Math.abs(from.x - to.x) + Math.abs(from.z - to.z)) * this.cellSize;
  }

  private isWalkable(point: NavigationPoint): boolean {
    return this.inBounds(point) && this.colliders.canOccupy(point.x, point.z);
  }

  private inBounds(point: NavigationPoint): boolean {
    return (
      point.x >= this.bounds.minX &&
      point.x <= this.bounds.maxX &&
      point.z >= this.bounds.minZ &&
      point.z <= this.bounds.maxZ
    );
  }

  private toCell(point: NavigationPoint): Cell {
    return {
      x: this.clampCell(Math.round((point.x - this.minX) / this.cellSize), this.columns),
      z: this.clampCell(Math.round((point.z - this.minZ) / this.cellSize), this.rows),
    };
  }

  private toPoint(cell: Cell): NavigationPoint {
    return {
      x: this.minX + cell.x * this.cellSize,
      z: this.minZ + cell.z * this.cellSize,
    };
  }

  private clampCell(value: number, size: number): number {
    return Math.min(Math.max(value, 0), size - 1);
  }

  private inGrid(cell: Cell): boolean {
    return cell.x >= 0 && cell.x < this.columns && cell.z >= 0 && cell.z < this.rows;
  }

  private key(cell: Cell): string {
    return `${cell.x},${cell.z}`;
  }
}
