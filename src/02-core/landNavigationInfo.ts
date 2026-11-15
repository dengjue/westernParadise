import { LAND_NAVIGATION } from '@/01-shared';
import { resolveLandRegion } from './landRegions';

export interface LandNavigationInfo {
  readonly headingDeg: number;
  readonly direction: string;
  readonly area: string;
  readonly landmark: string;
  /** 水平平面上的直线距离（米），不含 y 高差。 */
  readonly distance: number;
}

const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;
const FULL_CIRCLE_DEG = 360;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const DIRECTION_STEP_DEG = 45;

/**
 * 由世界坐标与角色 yaw 推导轻量导航信息。
 *
 * 北向采用世界 -Z，与主殿朝南、玩家从南侧向北进入的坐标约定一致；
 * heading 先换算到 [0, 360)，再映射八方位；区域按共享边界表定位，核心区子区与地标
 * 再取平面最近中心。只在低频 HUD 刷新时调用，不把分配放到渲染热循环。
 */
export function resolveLandNavigation(x: number, z: number, yawRad: number): LandNavigationInfo {
  const rawHeading = Math.atan2(Math.sin(yawRad), -Math.cos(yawRad)) * DEGREES_PER_RADIAN;
  const headingDeg = (rawHeading + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG;
  const directionIndex = Math.round(headingDeg / DIRECTION_STEP_DEG) % DIRECTIONS.length;

  let closestArea: (typeof LAND_NAVIGATION.areas)[number] = LAND_NAVIGATION.areas[0]!;
  let closestAreaDistance = Infinity;
  for (const area of LAND_NAVIGATION.areas) {
    const distance = Math.hypot(x - area.x, z - area.z);
    if (distance < closestAreaDistance) {
      closestArea = area;
      closestAreaDistance = distance;
    }
  }

  let closestLandmark: (typeof LAND_NAVIGATION.landmarks)[number] = LAND_NAVIGATION.landmarks[0]!;
  let closestLandmarkDistance = Infinity;
  for (const landmark of LAND_NAVIGATION.landmarks) {
    const distance = Math.hypot(x - landmark.x, z - landmark.z);
    if (distance < closestLandmarkDistance) {
      closestLandmark = landmark;
      closestLandmarkDistance = distance;
    }
  }
  const region = resolveLandRegion(x, z);
  const area = region && region.id !== 'core-court' ? region.label : closestArea.label;

  return {
    headingDeg,
    direction: DIRECTIONS[directionIndex]!,
    area,
    landmark: closestLandmark.label,
    distance: closestLandmarkDistance,
  };
}
