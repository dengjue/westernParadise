export type LandCellLoadState = 'queued' | 'loading' | 'ready' | 'error' | 'cancelled';
export type LandCellLoader<T> = (signal: AbortSignal) => T | Promise<T>;

interface CellLoadTask<T> {
  readonly key: string;
  readonly load: LandCellLoader<T>;
  readonly controller: AbortController;
  readonly promise: Promise<T | null>;
  readonly resolve: (value: T | null) => void;
  readonly reject: (reason: unknown) => void;
  state: LandCellLoadState;
  priority: number;
  settled: boolean;
  value?: T;
  error?: unknown;
}

export interface LandCellQueueOptions<T> {
  readonly maxConcurrent: number;
  readonly maxPending: number;
  /** 只释放队列拥有的 cell 资源；共享材质等资源必须由独立所有权池管理。 */
  readonly dispose: (value: T) => void;
}

export interface LandCellQueueSnapshot {
  readonly queued: number;
  readonly loading: number;
  readonly ready: number;
  readonly errors: number;
  readonly active: number;
  readonly pending: number;
}

/**
 * 有界、可取消、同 key 去重的异步 cell 构建队列。
 *
 * priority 数值越小越先执行。已取消的 loader 即使忽略 AbortSignal 并晚到成功，
 * 结果也会被释放而不会重新进入队列。该队列不假定载荷的资源结构、不访问浏览器。
 */
export class LandCellQueue<T> {
  private readonly entries = new Map<string, CellLoadTask<T>>();
  private readonly pending: CellLoadTask<T>[] = [];
  private activeCount = 0;
  private disposed = false;

  constructor(private readonly options: LandCellQueueOptions<T>) {
    if (
      !Number.isInteger(options.maxConcurrent) ||
      options.maxConcurrent < 1 ||
      !Number.isInteger(options.maxPending) ||
      options.maxPending < 0
    )
      throw new RangeError('cell 加载队列上限无效');
  }

  request(key: string, priority: number, load: LandCellLoader<T>): Promise<T | null> {
    if (this.disposed) return Promise.resolve(null);
    if (key.trim().length === 0 || !Number.isFinite(priority))
      throw new RangeError('cell key 或优先级无效');

    const existing = this.entries.get(key);
    if (existing?.state === 'ready') return Promise.resolve(existing.value!);
    if (existing?.state === 'queued') {
      existing.priority = Math.min(existing.priority, priority);
      this.sortPending();
      return existing.promise;
    }
    if (existing?.state === 'loading') return existing.promise;
    if (existing?.state === 'error') this.entries.delete(key);

    const task = this.createTask(key, priority, load);
    if (this.activeCount >= this.options.maxConcurrent && !this.makePendingRoom(task)) {
      task.state = 'cancelled';
      task.settled = true;
      task.resolve(null);
      return task.promise;
    }
    this.entries.set(key, task);
    this.pending.push(task);
    this.sortPending();
    this.pump();
    return task.promise;
  }

  /** 取消排队/运行中的 cell，或释放已就绪的 cell；重复调用安全。 */
  unload(key: string): boolean {
    const task = this.entries.get(key);
    if (!task) return false;
    this.entries.delete(key);
    if (task.state === 'queued') {
      const index = this.pending.indexOf(task);
      if (index >= 0) this.pending.splice(index, 1);
      task.state = 'cancelled';
      this.resolveTask(task, null);
      this.pump();
      return true;
    }
    if (task.state === 'loading') {
      task.state = 'cancelled';
      task.controller.abort();
      this.resolveTask(task, null);
      return true;
    }
    if (task.state === 'ready') {
      task.state = 'cancelled';
      this.options.dispose(task.value!);
      return true;
    }
    task.state = 'cancelled';
    this.rejectTask(task, new Error(`cell ${key} 已卸载`));
    return true;
  }

  /** 队列关闭后拒绝新请求，取消在途工作并释放所有已就绪载荷。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let firstError: unknown;
    let failed = false;
    for (const key of [...this.entries.keys()]) {
      try {
        this.unload(key);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  state(key: string): LandCellLoadState | null {
    return this.entries.get(key)?.state ?? null;
  }

  snapshot(): LandCellQueueSnapshot {
    let loading = 0,
      ready = 0,
      errors = 0;
    for (const task of this.entries.values()) {
      if (task.state === 'loading') loading++;
      else if (task.state === 'ready') ready++;
      else if (task.state === 'error') errors++;
    }
    return {
      queued: this.pending.length,
      loading,
      ready,
      errors,
      active: this.activeCount,
      pending: this.pending.length,
    };
  }

  private createTask(key: string, priority: number, load: LandCellLoader<T>): CellLoadTask<T> {
    let resolve!: (value: T | null) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T | null>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    return {
      key,
      priority,
      load,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      state: 'queued',
      settled: false,
    };
  }

  private makePendingRoom(incoming: CellLoadTask<T>): boolean {
    if (this.pending.length < this.options.maxPending) return true;
    const worst = this.pending[this.pending.length - 1];
    if (!worst || compareTasks(incoming, worst) >= 0) return false;
    this.unload(worst.key);
    return this.pending.length < this.options.maxPending;
  }

  private sortPending(): void {
    this.pending.sort(compareTasks);
  }

  private pump(): void {
    while (!this.disposed && this.activeCount < this.options.maxConcurrent) {
      const task = this.pending.shift();
      if (!task) return;
      if (this.entries.get(task.key) !== task || task.state !== 'queued') continue;
      task.state = 'loading';
      this.activeCount++;
      void Promise.resolve()
        .then(() => task.load(task.controller.signal))
        .then(
          (value) => this.finishSuccess(task, value),
          (error: unknown) => this.finishError(task, error),
        )
        .finally(() => {
          this.activeCount--;
          this.pump();
        });
    }
  }

  private finishSuccess(task: CellLoadTask<T>, value: T): void {
    if (
      this.entries.get(task.key) !== task ||
      task.state !== 'loading' ||
      task.controller.signal.aborted ||
      this.disposed
    ) {
      this.options.dispose(value);
      return;
    }
    task.value = value;
    task.state = 'ready';
    this.resolveTask(task, value);
  }

  private finishError(task: CellLoadTask<T>, error: unknown): void {
    if (this.entries.get(task.key) !== task || task.state !== 'loading') return;
    task.error = error;
    task.state = 'error';
    this.rejectTask(task, error);
  }

  private resolveTask(task: CellLoadTask<T>, value: T | null): void {
    if (task.settled) return;
    task.settled = true;
    task.resolve(value);
  }

  private rejectTask(task: CellLoadTask<T>, error: unknown): void {
    if (task.settled) return;
    task.settled = true;
    task.reject(error);
  }
}

function compareTasks<T>(a: CellLoadTask<T>, b: CellLoadTask<T>): number {
  return a.priority - b.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
