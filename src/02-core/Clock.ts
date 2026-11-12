/**
 * 固定步长时钟。
 *
 * 把每帧真实经过时间切成等长逻辑步，逻辑更新与刷新率解耦：
 * 30Hz 设备每帧走 2 步、120Hz 设备两帧才走 1 步，角色速度一致。
 * alpha 是「距离下一步的进度」，供渲染层做插值。
 *
 * 性能约束：advance() 每帧调用，**不返回新对象、不创建数组**，
 * 结果写在实例字段上由 getter 读取，避免主循环产生 GC 垃圾。
 */
export class Clock {
  private readonly stepMs: number;
  private readonly maxFrameDeltaMs: number;
  private accumulatorMs = 0;
  private stepsThisFrame = 0;
  private alphaValue = 0;
  private elapsedValue = 0;

  constructor(stepMs: number, maxFrameDeltaMs: number) {
    if (stepMs <= 0) {
      throw new RangeError('stepMs 必须为正数');
    }
    if (maxFrameDeltaMs < stepMs) {
      throw new RangeError('maxFrameDeltaMs 不得小于 stepMs');
    }
    this.stepMs = stepMs;
    this.maxFrameDeltaMs = maxFrameDeltaMs;
  }

  /**
   * 喂入本帧真实经过时间，更新内部状态。
   * 切后台回来时 deltaMs 可能高达数秒，必须截断，否则会一次补算上千步卡死主线程。
   */
  advance(deltaMs: number): this {
    const clamped = Math.min(Math.max(deltaMs, 0), this.maxFrameDeltaMs);
    this.accumulatorMs += clamped;
    this.elapsedValue += clamped;

    let steps = 0;
    while (this.accumulatorMs >= this.stepMs) {
      this.accumulatorMs -= this.stepMs;
      steps += 1;
    }
    this.stepsThisFrame = steps;
    this.alphaValue = this.accumulatorMs / this.stepMs;
    return this;
  }

  /** 单个逻辑步的时长（毫秒），供主循环回传给更新回调。 */
  get stepDurationMs(): number {
    return this.stepMs;
  }

  /** 本帧应执行的逻辑步数。 */
  get steps(): number {
    return this.stepsThisFrame;
  }

  /** 距离下一步的插值进度，[0, 1)。 */
  get alpha(): number {
    return this.alphaValue;
  }

  /** 累计逻辑时间（毫秒，已截断异常帧）。 */
  get elapsedMs(): number {
    return this.elapsedValue;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.stepsThisFrame = 0;
    this.alphaValue = 0;
    this.elapsedValue = 0;
  }
}
