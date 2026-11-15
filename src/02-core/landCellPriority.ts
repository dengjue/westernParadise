export interface LandCellCandidate {
  readonly key: string;
  readonly centerX: number;
  readonly centerZ: number;
}

export interface LandCellCameraPose {
  readonly x: number;
  readonly z: number;
  readonly forwardX: number;
  readonly forwardZ: number;
}

export interface LandCellPriorityOptions {
  /** 无论相机朝向都应保持驻留的近区半径。 */
  readonly activeRadius: number;
  /** 仅在视线前方预取的最远距离。 */
  readonly prefetchRadius: number;
  /** 预取扇区的最小方向点积，范围 [-1, 1]。 */
  readonly minimumForwardDot: number;
  /** 前向预取排序奖励（米）；只影响同级队列顺序，不扩大半径。 */
  readonly frontBias: number;
  /** 单次规划最多返回的 cell 数。 */
  readonly maxCells: number;
}

export interface PrioritizedLandCell extends LandCellCandidate {
  readonly distance: number;
  readonly forwardDot: number;
  readonly intent: 'active' | 'prefetch';
  readonly priority: number;
}

/**
 * 纯函数式 cell 需求规划：近区不受朝向限制，远区只预取前方扇区，并用 maxCells
 * 给计划设置硬上限。它只计算顺序，不触发加载、创建 GPU 资源或访问浏览器状态。
 */
export function prioritizeLandCells(
  candidates: readonly LandCellCandidate[],
  camera: LandCellCameraPose,
  options: LandCellPriorityOptions,
): PrioritizedLandCell[] {
  validateOptions(options);
  const forwardLength = Math.hypot(camera.forwardX, camera.forwardZ);
  if (
    !Number.isFinite(camera.x) ||
    !Number.isFinite(camera.z) ||
    !Number.isFinite(forwardLength) ||
    forwardLength <= Number.EPSILON
  )
    return [];

  // 对重复 key 使用坐标排序后的首项，避免候选收集顺序改变计划结果。
  const orderedCandidates = candidates
    .filter(
      ({ key, centerX, centerZ }) =>
        key.trim().length > 0 && Number.isFinite(centerX) && Number.isFinite(centerZ),
    )
    .slice()
    .sort((a, b) => compareKey(a.key, b.key) || a.centerX - b.centerX || a.centerZ - b.centerZ);
  const seen = new Set<string>();
  const result: PrioritizedLandCell[] = [];
  for (const cell of orderedCandidates) {
    if (seen.has(cell.key)) continue;
    seen.add(cell.key);
    const dx = cell.centerX - camera.x;
    const dz = cell.centerZ - camera.z;
    const distance = Math.hypot(dx, dz);
    const forwardDot =
      distance <= Number.EPSILON
        ? 1
        : (dx * camera.forwardX + dz * camera.forwardZ) / (distance * forwardLength);
    const intent =
      distance <= options.activeRadius
        ? 'active'
        : distance <= options.prefetchRadius && forwardDot >= options.minimumForwardDot
          ? 'prefetch'
          : null;
    if (!intent) continue;
    result.push({
      ...cell,
      distance,
      forwardDot,
      intent,
      priority: distance - Math.max(0, forwardDot) * options.frontBias,
    });
  }

  result.sort(
    (a, b) =>
      Number(a.intent !== 'active') - Number(b.intent !== 'active') ||
      a.priority - b.priority ||
      a.distance - b.distance ||
      compareKey(a.key, b.key),
  );
  return result.slice(0, options.maxCells);
}

function validateOptions(options: LandCellPriorityOptions): void {
  if (
    !Number.isFinite(options.activeRadius) ||
    options.activeRadius < 0 ||
    !Number.isFinite(options.prefetchRadius) ||
    options.prefetchRadius < options.activeRadius ||
    !Number.isFinite(options.minimumForwardDot) ||
    options.minimumForwardDot < -1 ||
    options.minimumForwardDot > 1 ||
    !Number.isFinite(options.frontBias) ||
    options.frontBias < 0 ||
    !Number.isInteger(options.maxCells) ||
    options.maxCells < 1
  )
    throw new RangeError('cell 优先级规划参数无效');
}

function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
