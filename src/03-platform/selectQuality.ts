import type { Capabilities, PlatformParams, QualityTier } from '@/00-types';
import { QUALITY_ORDER } from '@/01-shared';

export interface QualityDecision {
  readonly tier: QualityTier;
  /** 决策理由，用于日志与 UI 提示，避免「为什么突然变糊」变成黑盒。 */
  readonly reason: string;
}

/** 沿 QUALITY_ORDER 平移若干档，越界时钳制到端点。 */
function shift(tier: QualityTier, delta: number): QualityTier {
  const index = QUALITY_ORDER.indexOf(tier);
  const next = Math.min(Math.max((index < 0 ? 1 : index) + delta, 0), QUALITY_ORDER.length - 1);
  // index 已被钳制在合法范围内；?? 只是满足 noUncheckedIndexedAccess 的静态检查。
  return QUALITY_ORDER[next] ?? 'medium';
}

/**
 * 画质决策矩阵（优先级从高到低）：
 *   1. URL 显式指定  → 完全尊重，便于截图对比与复现；
 *   2. 本地记忆      → 用户上次手动选过就沿用；
 *   3. 设备能力      → 移动端 / 少核 / 低内存 / WebGL1 自动降档；
 *   4. 减动效偏好    → 再降一档（系统级可访问性偏好优先于画质）。
 *
 * 刻意不自动给 ultra：最高档必须由用户显式选择，避免一上来就把低端机拖垮。
 */
export function selectQuality(
  params: PlatformParams,
  capabilities: Capabilities,
  stored: QualityTier | null = null,
): QualityDecision {
  if (params.quality !== null) {
    return { tier: params.quality, reason: 'URL 参数显式指定' };
  }
  if (stored !== null) {
    return { tier: stored, reason: '沿用本地画质设置' };
  }
  if (capabilities.webgl === 'none') {
    return { tier: 'low', reason: '未检测到 WebGL，按最低档返回' };
  }

  let tier: QualityTier;
  if (capabilities.mobile || capabilities.hardwareConcurrency <= 2) {
    tier = 'low';
  } else if (capabilities.deviceMemoryGb !== null && capabilities.deviceMemoryGb <= 4) {
    tier = 'medium';
  } else if (capabilities.hardwareConcurrency >= 8) {
    tier = 'high';
  } else {
    tier = 'medium';
  }

  // WebGL1 不支持部分后处理与阴影特性，无论 CPU 多强都封顶到 medium。
  if (
    capabilities.webgl === 'webgl1' &&
    QUALITY_ORDER.indexOf(tier) > QUALITY_ORDER.indexOf('medium')
  ) {
    tier = 'medium';
  }

  if (capabilities.reducedMotion) {
    tier = shift(tier, -1);
  }

  return { tier, reason: '按设备能力自动决策' };
}
