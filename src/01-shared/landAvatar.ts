const APPEARANCE = Object.freeze({
  bodyColor: 0x628579,
  headColor: 0xd4b894,
  hairColor: 0x343b36,
  trouserColor: 0x435a53,
  shoeColor: 0x51463b,
  packColor: 0x8a6b4a,
  accentColor: 0xb39157,
  featureColor: 0x403931,
  roughness: 0.84,
  torso: Object.freeze({ topRadius: 0.2, bottomRadius: 0.285, height: 0.62, centerY: 1.13 }),
  head: Object.freeze({ radius: 0.155, centerY: 1.59 }),
  shoulder: Object.freeze({ x: 0.255, y: 1.34, limbRadius: 0.066, limbLength: 0.34 }),
  hip: Object.freeze({ x: 0.115, y: 0.8, limbRadius: 0.09, limbLength: 0.4 }),
  foot: Object.freeze({ width: 0.15, height: 0.12, depth: 0.25, forward: 0.055 }),
  backpack: Object.freeze({ radius: 0.115, height: 0.14, y: 1.15, z: -0.19 }),
});

/** 第三人称访客的比例、配色与跟随相机参数；长度用米、角度用弧度。 */
export const LAND_AVATAR = Object.freeze({
  appearance: APPEARANCE,
  /** 第三人称漫游步行速度；第一人称速度保持历史配置。 */
  walkSpeed: 2.4,
  /** 角色碰撞/网络间距仍按外套宽度和真实头顶计算。 */
  bodyRadius: APPEARANCE.torso.bottomRadius,
  headRadius: APPEARANCE.head.radius,
  headHeight: APPEARANCE.head.centerY + APPEARANCE.head.radius,
  /** 朝向缓动角速度（弧度/秒）：角色面向移动方向，而不是瞬间转向。 */
  turnSpeed: 9,
  motion: Object.freeze({
    /** 完整左右步态周期对应的实际行进距离；相位按位移而非帧时间推进。 */
    walkCycleDistance: 1.25,
    /** 行走时四肢最大摆幅（弧度），控制在舒缓散步范围。 */
    legSwing: 0.34,
    armSwing: 0.2,
    /** 站立呼吸周期及上身细微起伏（米）。 */
    idleCycleSeconds: 5.2,
    idleBreath: 0.012,
    walkBodyBob: 0.009,
    /** 起步与停步时动作混合的趋近速度（每秒）。 */
    blendRate: 10,
    /** 空中姿态参数：悬停收臂，水平提速后舒展；起降时四肢与上身略作收势。 */
    flight: Object.freeze({
      hoverArmSpread: 0.28,
      glideArmSpread: 0.78,
      /** 起飞初始姿势停留时间；之后即使仍在爬升也平滑过渡到悬停姿势。 */
      takeoffPoseSeconds: 0.75,
      takeoffArmSpread: 0.52,
      landingArmSpread: 0.2,
      glideArmPitch: -0.1,
      takeoffArmPitch: -0.25,
      landingArmPitch: 0.14,
      hoverLegPitch: 0.04,
      glideLegPitch: 0.16,
      takeoffLegPitch: -0.12,
      landingLegPitch: -0.18,
      takeoffBodyPitch: 0.12,
      glideBodyPitch: 0.04,
      landingBodyPitch: 0.13,
      verticalBodyPitch: 0.08,
      landingLowering: 0.025,
    }),
  }),
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
