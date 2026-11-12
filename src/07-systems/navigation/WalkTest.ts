import type { NavigationPoint, GridNavigator, GridPath } from './GridNavigator';

export interface WalkTestRoute {
  readonly id: string;
  readonly start: NavigationPoint;
  readonly target: NavigationPoint;
}

export interface WalkTestCase {
  readonly id: string;
  readonly passed: boolean;
  readonly path: GridPath | null;
}

export interface WalkTestReport {
  readonly passed: boolean;
  readonly cases: readonly WalkTestCase[];
}

/** 按配置路线执行一次离线走查；报告保留路径和搜索统计，便于失败时定位具体路线。 */
export function runWalkTest(
  navigator: GridNavigator,
  routes: readonly WalkTestRoute[],
): WalkTestReport {
  const cases = routes.map((route) => {
    const path = navigator.findPath(route.start, route.target);
    return Object.freeze({
      id: route.id,
      passed: path !== null && path.points.length > 0,
      path,
    });
  });
  return Object.freeze({
    passed: cases.every((testCase) => testCase.passed),
    cases: Object.freeze(cases),
  });
}
