const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

/**
 * 把任意角度归一到 (-π, π]：跨 0° 的最短转向量。
 * 角色朝向、相机 yaw 的缓动都需要「往近处转」，直接做差会绕远路。
 */
export function shortestAngle(angle: number): number {
  const normalized = (angle + HALF_TURN) % FULL_TURN;
  return (normalized < 0 ? normalized + FULL_TURN : normalized) - HALF_TURN;
}

/** 从 current 向 target 转动，最多 maxStep 弧度；返回落点角度。 */
export function moveAngle(current: number, target: number, maxStep: number): number {
  const difference = shortestAngle(target - current);
  if (Math.abs(difference) <= maxStep) {
    return target;
  }
  return current + Math.sign(difference) * maxStep;
}
