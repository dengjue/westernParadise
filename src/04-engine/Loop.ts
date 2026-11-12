import type { AppEventMap, EventBusLike, FrameTick } from '@/00-types';
import type { Clock } from '@/02-core';

export interface LoopOptions {
  readonly clock: Clock;
  readonly events: EventBusLike<AppEventMap>;
  /** 每个固定逻辑步调用一次，stepMs 恒定，与刷新率无关。 */
  readonly onStep: (stepMs: number) => void;
  /** 每帧渲染前调用一次，alpha 是帧间插值进度。 */
  readonly onRender: (alpha: number) => void;
}

/**
 * requestAnimationFrame 主循环。
 *
 * 零分配约束：tick 是实例字段上的箭头函数（只创建一次），
 * frameTick 是复用的载荷对象（每帧原地改字段，不 new），
 * 循环体内不查询 DOM、不拼字符串、不重建纹理。
 */
export class Loop {
  private readonly clock: Clock;
  private readonly events: EventBusLike<AppEventMap>;
  private readonly onStep: (stepMs: number) => void;
  private readonly onRender: (alpha: number) => void;
  private readonly frameTick: FrameTick = { deltaMs: 0, elapsedMs: 0 };
  private rafId: number | null = null;
  private lastTimeMs = 0;
  private running = false;

  constructor(options: LoopOptions) {
    this.clock = options.clock;
    this.events = options.events;
    this.onStep = options.onStep;
    this.onRender = options.onRender;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastTimeMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) {
      return;
    }
    const deltaMs = now - this.lastTimeMs;
    this.lastTimeMs = now;

    this.clock.advance(deltaMs);
    for (let i = 0; i < this.clock.steps; i += 1) {
      this.onStep(this.clock.stepDurationMs);
    }

    this.frameTick.deltaMs = deltaMs;
    this.frameTick.elapsedMs = this.clock.elapsedMs;
    // 注意：载荷是复用对象，订阅者不得保存引用（见 00-types/events.ts 注释）。
    this.events.emit('app:frame', this.frameTick);

    this.onRender(this.clock.alpha);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
