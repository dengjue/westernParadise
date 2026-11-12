import type { QualityTier } from './contracts';

/**
 * 事件总线契约。
 * 事件名与载荷类型全部收在 AppEventMap 中，禁止在业务代码里用裸字符串 emit，
 * 这样重命名事件或改载荷时 TypeScript 会直接报错，而不是运行时静默失效。
 */
export type EventHandler<T> = (payload: T) => void;

/**
 * 帧事件载荷。
 * 刻意使用**可变字段**：主循环每帧复用同一个实例，避免每帧分配对象造成 GC 抖动。
 * 约定：订阅者只能当场读取，不得保存该引用，也不得修改它。
 */
export interface FrameTick {
  deltaMs: number;
  elapsedMs: number;
}

export interface AppEventMap {
  'app:ready': { readonly startedAt: number };
  'app:frame': FrameTick;
  'app:resize': { readonly width: number; readonly height: number };
  'app:fatal': { readonly error: Error; readonly phase: string };
  'quality:changed': { readonly from: QualityTier; readonly to: QualityTier };
}

export interface EventBusLike<M extends object> {
  /** 订阅，返回退订函数；推荐优先使用返回值而不是手动 off，避免 handler 引用丢失。 */
  on<K extends keyof M>(type: K, handler: EventHandler<M[K]>): () => void;
  off<K extends keyof M>(type: K, handler: EventHandler<M[K]>): void;
  emit<K extends keyof M>(type: K, payload: M[K]): void;
  clear(): void;
  readonly size: number;
}
