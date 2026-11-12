/**
 * 全局契约层：只放类型声明，零实现、零副作用。
 * 本层不得 import 任何 src 内模块，由 scripts/check-layers.mjs 强制。
 */

/** 画质档位，低 → 高。顺序与 01-shared/config.ts 的 QUALITY_ORDER 一致。 */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

/** 单个画质档位的具体渲染参数，集中配置，禁止散落到渲染逻辑里。 */
export interface QualityProfile {
  readonly pixelRatioCap: number;
  readonly shadow: boolean;
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
