import type { QualityTier } from '@/00-types';
import { QUALITY_ORDER, STORAGE_NAMESPACE } from '@/01-shared';

/**
 * 本地设置持久化。
 * 只做「画质」等少量用户偏好，不存任何内容数据、不联网。
 * 存储对象由外部注入，便于单测用内存实现；同时避免隐私模式下直接访问
 * localStorage 抛异常导致启动失败。
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const QUALITY_KEY = `${STORAGE_NAMESPACE}:quality`;

export function readStoredQuality(store: KeyValueStore | null): QualityTier | null {
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(QUALITY_KEY);
    return QUALITY_ORDER.find((tier) => tier === raw) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredQuality(store: KeyValueStore | null, tier: QualityTier): void {
  if (!store) {
    return;
  }
  try {
    store.setItem(QUALITY_KEY, tier);
  } catch {
    // 配额满 / 隐私模式：设置不持久化不应影响本次运行。
  }
}

/** 取一个可用的存储对象；不可用时返回 null，由上层静默降级。 */
export function resolveStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
