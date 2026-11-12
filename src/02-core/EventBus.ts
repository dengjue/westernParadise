import type { EventBusLike, EventHandler } from '@/00-types';

/** 内部存储用的擦除类型；类型安全由 on/off/emit 的泛型签名在边界处保证。 */
type ErasedHandler = (payload: never) => void;

export interface EventBusOptions {
  /** 单个订阅者抛错时的处理钩子；默认打印到控制台，不中断其余订阅者。 */
  readonly onError?: (error: unknown, type: PropertyKey) => void;
}

/**
 * 类型安全的发布订阅总线。
 *
 * 两个刻意的设计决定：
 * 1. emit 时**直接遍历原 Set，不复制数组**。主循环每帧都会 emit `app:frame`，
 *    复制一个数组会造成持续 GC 抖动。代价是「派发过程中新增的订阅下一轮才生效」，
 *    这个语义已写入接口注释，属于可接受的约定。
 * 2. 单个 handler 抛错被隔离，不影响其他订阅者，也不让错误穿透到渲染循环。
 */
export class EventBus<M extends object> implements EventBusLike<M> {
  private readonly handlers = new Map<keyof M, Set<ErasedHandler>>();
  private readonly onError: (error: unknown, type: PropertyKey) => void;

  constructor(options: EventBusOptions = {}) {
    this.onError =
      options.onError ??
      ((error, type) => {
        console.error(`[EventBus] 订阅者异常 type=${String(type)}`, error);
      });
  }

  private bucket(type: keyof M): Set<ErasedHandler> {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set<ErasedHandler>();
      this.handlers.set(type, set);
    }
    return set;
  }

  on<K extends keyof M>(type: K, handler: EventHandler<M[K]>): () => void {
    this.bucket(type).add(handler as unknown as ErasedHandler);
    return () => {
      this.off(type, handler);
    };
  }

  off<K extends keyof M>(type: K, handler: EventHandler<M[K]>): void {
    const set = this.handlers.get(type);
    if (!set) {
      return;
    }
    set.delete(handler as unknown as ErasedHandler);
    if (set.size === 0) {
      this.handlers.delete(type);
    }
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        (handler as unknown as EventHandler<M[K]>)(payload);
      } catch (error) {
        this.onError(error, type);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }

  get size(): number {
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }
}
