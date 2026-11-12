/**
 * 全局契约层：只放类型声明，零实现、零副作用。
 * 本层不得 import 任何 src 内模块，由 scripts/check-layers.mjs 强制。
 */

/** 画质档位，低 → 高。顺序与 01-shared/config.ts 的 QUALITY_ORDER 一致。 */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

/** M1 只允许三个离散时段，避免配置层提前引入连续插值语义。 */
export type TimeOfDayId = 'dawn' | 'noon' | 'dusk';

/** 天气预设的程序化粒子类型；阶段 3.3 先落地雨，雪留后续增量。 */
export type WeatherEffectId = 'none' | 'rain';

export type WeatherId = 'clear' | 'mist' | 'rain';

/** 导览点 ID 与文案表一一对应，避免构件和文案键在运行时错配。 */
export type GuideId = 'taiji' | 'zhulie' | 'wuyan' | 'puzhuang';

/** 玩家活动边界的水平 AABB，坐标统一采用世界空间 x / z 轴。 */
export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** 静态碰撞只处理水平投影，避免把 M1 的简单漫游提前耦合到物理引擎。 */
export interface HorizontalAabb {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** 矩形地面高度区域，按配置顺序采样以支持后续叠加台阶。 */
export interface GroundHeightArea extends HorizontalAabb {
  readonly height: number;
}

/** 时段光照预设：渲染器一次性读取整组参数，不在配置层做插值。 */
export interface TimeOfDayPreset {
  readonly id: TimeOfDayId;
  readonly label: string;
  readonly sun: {
    readonly elevationDeg: number;
    readonly azimuthDeg: number;
    readonly colorHex: number;
    readonly intensity: number;
  };
  readonly ambient: {
    readonly colorHex: number;
    readonly intensity: number;
  };
  readonly skyTopHex: number;
  readonly skyBottomHex: number;
  readonly fog: {
    readonly colorHex: number;
    readonly near: number;
    readonly far: number;
  };
  readonly exposure: number;
}

/** 天气预设同时描述雾、天空色调和可选的程序化降水参数。 */
export interface WeatherPreset {
  readonly id: WeatherId;
  readonly label: string;
  readonly fogScale: {
    readonly near: number;
    readonly far: number;
  };
  readonly skyTintHex: number;
  readonly windStrength: number;
  readonly precipitation: {
    readonly effect: WeatherEffectId;
    readonly particleCount: number;
    readonly fallSpeed: number;
    readonly dropLength: number;
    readonly areaHeight: number;
    readonly colorHex: number;
    readonly opacity: number;
    readonly audioGain: number;
  };
}

/** 单个建筑导览触发点；事件层会把文案解析结果直接带给 UI。 */
export interface GuideEntry {
  readonly id: GuideId;
  readonly copyKey: GuideId;
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly radius: number;
}

/** 单个画质档位的具体渲染参数，集中配置，禁止散落到渲染逻辑里。 */
export interface QualityProfile {
  readonly pixelRatioCap: number;
  readonly shadow: boolean;
  readonly shadowMapSize: number;
  readonly antialias: boolean;
  readonly anisotropy: number;
  readonly maxLights: number;
}

/** 设备能力快照。所有字段由 platform 层探测后一次性生成，之后只读。 */
export interface Capabilities {
  readonly webgl: 'webgl2' | 'webgl1' | 'none';
  readonly touch: boolean;
  readonly mobile: boolean;
  readonly reducedMotion: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  /** 设备像素比，由 platform 层探测并钳制后传给渲染层。 */
  readonly pixelRatio: number;
}

/** URL 调试参数。quality 为 null 表示未显式指定，交给设备能力自动决策。 */
export interface PlatformParams {
  readonly quality: QualityTier | null;
  readonly tod: TimeOfDayId;
  readonly weather: WeatherId;
  readonly seed: number;
  readonly bench: boolean;
  readonly smoke: boolean;
  readonly debug: boolean;
  readonly noAudio: boolean;
}

/**
 * 可注入的环境描述。
 * 刻意不直接读 window：能力探测因此成为纯函数，可在 Node 单测里覆盖各种设备组合。
 */
export interface PlatformEnv {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  readonly reducedMotion: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly devicePixelRatio: number;
  readonly webgl2: boolean;
  readonly webgl1: boolean;
}
