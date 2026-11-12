import type { GuideEntry } from '@/00-types';

/**
 * 导览点使用世界空间位置和水平距离半径，先把触发数据与场景构件解耦；M1 不加入
 * world-space 标记，后续只需调整此表即可对齐实际生成的建筑位置。
 */
export const GUIDE_ENTRIES = Object.freeze({
  taiji: Object.freeze({
    id: 'taiji',
    copyKey: 'taiji',
    position: Object.freeze({
      x: 0,
      y: 0.8,
      z: -9,
    } as const),
    radius: 4,
  } as const satisfies GuideEntry),
  zhulie: Object.freeze({
    id: 'zhulie',
    copyKey: 'zhulie',
    position: Object.freeze({
      x: -6,
      y: 1.2,
      z: -9,
    } as const),
    radius: 3.5,
  } as const satisfies GuideEntry),
  wuyan: Object.freeze({
    id: 'wuyan',
    copyKey: 'wuyan',
    position: Object.freeze({
      x: 0,
      y: 3.2,
      z: -12,
    } as const),
    radius: 4,
  } as const satisfies GuideEntry),
  puzhuang: Object.freeze({
    id: 'puzhuang',
    copyKey: 'puzhuang',
    position: Object.freeze({
      x: 3,
      y: 0.2,
      z: 4,
    } as const),
    radius: 5,
  } as const satisfies GuideEntry),
} as const satisfies Readonly<Record<GuideEntry['id'], GuideEntry>>);
