/**
 * 阶段 2 有界飞行和导航原型配置。
 *
 * 飞行高度下限取 42m：当前主殿最高金色构件约 38.4m，留出约 3.6m 垂直余量；
 * 飞行水平边界由 PURE_LAND.bounds 内缩 worldInset 得到，不随便飞出已建场景。
 * 这些值只适用于当前原型，不作为后续大世界的固定规格。
 */
export const LAND_FLIGHT = Object.freeze({
  worldInset: 4,
  minAltitude: 42,
  maxAltitude: 64,
  horizontalSpeed: 9,
  verticalSpeed: 6,
  acceleration: 5,
  braking: 7,
  /** 飞行观察更远的跟随距离与轻微俯视角；步行时恢复进入飞行前的相机状态。 */
  followDistance: 7.2,
  defaultPitch: 0.34,
  navigationUpdateMs: 200,
});

/** 仅用于屏幕定位的区域/地标中心，均为当前世界中的约略标注点。 */
export const LAND_NAVIGATION = Object.freeze({
  areas: [
    { id: 'central-court', label: '中轴庭院', x: 0, z: 42 },
    { id: 'main-hall', label: '主殿台地', x: 0, z: -51 },
    { id: 'lotus-pond', label: '莲池东庭', x: 33, z: 28 },
    { id: 'western-grove', label: '西侧宝林', x: -39, z: 28 },
  ],
  landmarks: [
    { id: 'main-hall', label: '无量光殿', x: 0, z: -51 },
    { id: 'lotus-pond', label: '七宝莲池', x: 33, z: 28 },
    { id: 'western-grove', label: '七重宝树', x: -39, z: 28 },
    { id: 'north-gate', label: '北侧游线', x: 0, z: 84 },
  ],
} as const);
