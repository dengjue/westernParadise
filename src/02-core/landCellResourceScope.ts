import type { SharedResourceLease } from './sharedResourcePool';

export interface LandCellResourceScopeSnapshot {
  readonly localResources: number;
  readonly sharedLeases: number;
  readonly disposed: boolean;
}

/**
 * 单个 cell 的资源所有权边界。
 *
 * 先释放 cell 独占资源（例如几何），再释放共享资源 lease（例如材质），避免
 * cell 仍持有 GPU 对象时提前销毁共享依赖。所有释放均幂等，错误时继续清理其余资源。
 */
export class LandCellResourceScope {
  private readonly localDisposers: Array<() => void> = [];
  private readonly sharedLeases = new Set<SharedResourceLease<unknown>>();
  private disposed = false;

  own<T>(value: T, dispose: (value: T) => void): T {
    this.assertActive();
    this.localDisposers.push(() => dispose(value));
    return value;
  }

  /** 将 lease 的释放责任转交给本 cell scope，并返回其共享值供装配使用。 */
  use<T>(lease: SharedResourceLease<T>): T {
    this.assertActive();
    this.sharedLeases.add(lease as SharedResourceLease<unknown>);
    return lease.value;
  }

  snapshot(): LandCellResourceScopeSnapshot {
    return {
      localResources: this.localDisposers.length,
      sharedLeases: this.sharedLeases.size,
      disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let firstError: unknown;
    let failed = false;
    for (let index = this.localDisposers.length - 1; index >= 0; index--) {
      try {
        this.localDisposers[index]!();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    this.localDisposers.length = 0;
    for (const lease of this.sharedLeases) {
      try {
        lease.release();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    this.sharedLeases.clear();
    if (failed) throw firstError;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('cell 资源作用域已释放');
  }
}
