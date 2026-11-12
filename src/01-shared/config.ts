import type { QualityProfile, QualityTier } from '@/00-types';
import buildBudget from './build-budget.json';

/**
 * 全应用唯一配置源。
 * 所有对象都冻结：配置只能在启动时读取，运行中不得被任何模块改写，
 * 否则「同一 seed 可复现」与画质决策都会变成不可追踪的状态。
 */

export const APP = Object.freeze({
  name: '数字庭院',
  version: '0.1.0',
  about: '技术探索原型，仅供本地离线使用，不对外提供宗教信息服务。',
} as const);

export const RENDER = Object.freeze({
  clearColor: 0x14181a,
  fovDeg: 62,
  near: 0.1,
  far: 240,
  /** 固定步长：逻辑更新与帧率解耦，低帧率设备不会「走得更快」。 */
  fixedStepMs: 1000 / 60,
  /** 单帧时间上限：切后台回来时防止一次补算上千帧导致卡死。 */
  maxFrameDeltaMs: 250,
  /** 天空穹顶半径使用远裁剪面的比例，保证相机始终在穹顶内部。 */
  skyDomeRadiusFactor: 0.95,
  /** 穹顶只负责渐变背景，分段数控制在足够平滑与低端机成本之间。 */
  skyDomeWidthSegments: 32,
  skyDomeHeightSegments: 16,
  cameraStart: Object.freeze({ x: 0, y: 1.7, z: 6 }),
  /** 冒烟占位地面尺寸，M1 场景落地后由场景配置取代。 */
  placeholderGroundSize: 24,
} as const);

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  low: Object.freeze({
    pixelRatioCap: 1,
    shadow: false,
    shadowMapSize: 0,
    antialias: false,
    anisotropy: 1,
    maxLights: 1,
  }),
  medium: Object.freeze({
    pixelRatioCap: 1.25,
    shadow: false,
    shadowMapSize: 0,
    antialias: true,
    anisotropy: 2,
    maxLights: 2,
  }),
  high: Object.freeze({
    pixelRatioCap: 1.75,
    shadow: true,
    shadowMapSize: 1024,
    antialias: true,
    anisotropy: 4,
    maxLights: 3,
  }),
  ultra: Object.freeze({
    pixelRatioCap: 2,
    shadow: true,
    shadowMapSize: 2048,
    antialias: true,
    anisotropy: 8,
    maxLights: 4,
  }),
});

export const QUALITY_ORDER: readonly QualityTier[] = Object.freeze([
  'low',
  'medium',
  'high',
  'ultra',
]);

/** 默认随机种子：写死一个可复现值，便于 bug 复现；可通过 ?seed= 覆盖。 */
export const DEFAULT_SEED = 20261112;

/** localStorage 键前缀，集中管理避免各模块乱起名字。 */
export const STORAGE_NAMESPACE = 'wssm';

/**
 * 单文件体积预算（字节）。
 * 数值来自 build-budget.json：TypeScript 运行时配置与 Node 构建校验脚本读同一份，
 * 避免「代码里一个阈值、校验脚本里另一个阈值」这种隐性不一致。
 * 超过硬上限即视为退化，需裁剪 three 未用模块，而不是压缩源码可读性。
 */
export const SINGLE_FILE_BUDGET_BYTES = buildBudget.budgetBytes;
export const SINGLE_FILE_HARD_LIMIT_BYTES = buildBudget.hardLimitBytes;
