export interface FrameBudgetStats {
  frames: number;
  steps: number;
  maxStepMs: number;
  maxStepLabel: string;
  overBudgetSteps: number;
  elapsedMs: number;
}

export interface FrameBudgetDriverOptions<T> {
  iterator: Generator<void, T, void>;
  budgetMs: number;
  deferFirstFrame?: boolean;
  getStepLabel?: () => string;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  onComplete: (value: T, stats: Readonly<FrameBudgetStats>) => void;
  onError: (error: unknown, stats: Readonly<FrameBudgetStats>) => void;
}

/** 将确定性 generator 步骤分散到 RAF；单个 next() 仍可能超出预算，统计会暴露该情况。 */
export class FrameBudgetDriver<T> {
  readonly stats: FrameBudgetStats = {
    frames: 0,
    steps: 0,
    maxStepMs: 0,
    maxStepLabel: '',
    overBudgetSteps: 0,
    elapsedMs: 0,
  };

  private readonly iterator: Generator<void, T, void>;
  private readonly budgetMs: number;
  private readonly now: () => number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly onComplete: FrameBudgetDriverOptions<T>['onComplete'];
  private readonly onError: FrameBudgetDriverOptions<T>['onError'];
  private readonly deferFirstFrame: boolean;
  private readonly getStepLabel: (() => string) | undefined;
  private rafId: number | null = null;
  private startedAt = 0;
  private started = false;
  private paused = false;
  private finished = false;
  private cancelled = false;
  private firstFrame = true;

  constructor(options: FrameBudgetDriverOptions<T>) {
    if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0)
      throw new RangeError(`frame budget 必须大于 0：${options.budgetMs}`);
    this.iterator = options.iterator;
    this.budgetMs = options.budgetMs;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
    this.onComplete = options.onComplete;
    this.onError = options.onError;
    this.deferFirstFrame = options.deferFirstFrame ?? false;
    this.getStepLabel = options.getStepLabel;
  }

  start(): void {
    if (this.started || this.cancelled || this.finished) return;
    this.started = true;
    this.startedAt = this.now();
    this.schedule();
  }

  pause(): void {
    if (this.cancelled || this.finished || this.paused) return;
    this.paused = true;
    this.cancelPendingFrame();
  }

  resume(): void {
    if (this.cancelled || this.finished || !this.paused) return;
    this.paused = false;
    this.schedule();
  }

  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.cancelPendingFrame();
    this.iterator.return?.(undefined as T);
  }

  private schedule(): void {
    if (this.rafId !== null || this.paused || this.cancelled || this.finished) return;
    this.rafId = this.requestFrame(this.tick);
  }

  private cancelPendingFrame(): void {
    if (this.rafId === null) return;
    this.cancelFrame(this.rafId);
    this.rafId = null;
  }

  private readonly tick: FrameRequestCallback = () => {
    this.rafId = null;
    if (this.paused || this.cancelled || this.finished) return;
    this.stats.frames++;
    if (this.deferFirstFrame && this.firstFrame) {
      this.firstFrame = false;
      this.schedule();
      return;
    }

    const deadline = this.now() + this.budgetMs;
    do {
      const stepStart = this.now();
      let result: IteratorResult<void, T>;
      try {
        result = this.iterator.next();
      } catch (error) {
        this.fail(error);
        return;
      }
      const stepMs = Math.max(0, this.now() - stepStart);
      this.stats.steps++;
      if (stepMs > this.stats.maxStepMs) {
        this.stats.maxStepMs = stepMs;
        this.stats.maxStepLabel = this.getStepLabel?.() ?? '';
      }
      if (stepMs > this.budgetMs) this.stats.overBudgetSteps++;

      if (result.done) {
        this.finished = true;
        this.stats.elapsedMs = Math.max(0, this.now() - this.startedAt);
        try {
          this.onComplete(result.value, this.stats);
        } catch (error) {
          this.onError(error, this.stats);
        }
        return;
      }
    } while (this.now() < deadline);

    this.schedule();
  };

  private fail(error: unknown): void {
    this.finished = true;
    this.stats.elapsedMs = Math.max(0, this.now() - this.startedAt);
    this.cancelPendingFrame();
    this.onError(error, this.stats);
  }
}
