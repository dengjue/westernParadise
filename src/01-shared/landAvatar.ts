/**
 * 第三人称角色（LandAvatar）与跟随相机配置。
 *
 * 原型口径见 `02-方案/20-阶段1-第三人称交互原型实施规范.md`：
 * 角色是极简胶囊 + 头部的程序化人形，非交互、非仪式化；相机是环绕角色的弹簧臂，
 * 遮挡回拉用限频 raycast。所有数值集中在这一处，逻辑代码不出现魔法数字。
 * 单位：米、秒、弧度、像素。
 */
export const LAND_AVATAR = Object.freeze({
  /** 胶囊身体：半径与柱段高度；总身高 ≈ bodyHeight + 2 × bodyRadius。 */
  bodyRadius: 0.32,
  bodyHeight: 1.15,
  bodyColor: 0x64716b,
  headColor: 0xc6ad7f,
  roughness: 0.82,
  /** 头部球体半径与球心离脚底高度。 */
  headRadius: 0.17,
  headHeight: 1.62,
  /** 朝向缓动角速度（弧度/秒）：角色面向移动方向，而不是瞬间转向。 */
  turnSpeed: 9,
  camera: Object.freeze({
    /** 弹簧臂默认臂长与滚轮可调范围。 */
    defaultDistance: 4.4,
    minDistance: 2.4,
    maxDistance: 7.6,
    /** 每次滚轮格的臂长增量。 */
    distanceStep: 0.55,
    /** 默认俯仰与钳制范围（弧度，正值为俯视）。 */
    defaultPitch: 0.24,
    minPitch: -0.5,
    maxPitch: 1.15,
    /** 相机位置与注视点的指数阻尼基准（60fps 下的单帧趋近量，按帧率换算）。 */
    ease: 0.22,
    /** 注视点离脚底高度：略低于头顶，保证角色头部不顶出画面上沿。 */
    lookAtHeight: 1.4,
  }),
  occlusion: Object.freeze({
    /** 遮挡 raycast 间隔（毫秒）：限频避免每帧射线查询造成 GC/性能扰动。 */
    rayIntervalMs: 120,
    /** 命中后臂长的回收余量（米），防止镜头贴着墙面穿模。 */
    margin: 0.35,
    /** 回拉量与恢复的指数趋缓系数（每秒）。 */
    ease: 10,
  }),
} as const);

export type LandAvatarConfig = typeof LAND_AVATAR;

// 临时编号在当前房间内唯一，颜色循环用于辨认同伴，不作为身份标识。
const COMPANION_COLORS = [
  { name: '松青', hex: 0x477d71 },
  { name: '赭红', hex: 0xb16655 },
  { name: '靛蓝', hex: 0x557da7 },
  { name: '秋金', hex: 0xb19450 },
  { name: '藤紫', hex: 0x93799e },
  { name: '竹绿', hex: 0x839055 },
] as const;

export function companionColor(id: string) {
  return COMPANION_COLORS[(Number(id) - 1) % COMPANION_COLORS.length]!;
}
