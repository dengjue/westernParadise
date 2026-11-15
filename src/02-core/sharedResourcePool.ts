export interface SharedResourceLease<T> {
  readonly value: T;
  /** 首次释放返回 true；重复释放或资源池关闭后返回 false。 */
  release(): boolean;
}

export interface SharedResourcePoolSnapshot {
  readonly resources: number;
  readonly leases: number;
  readonly closed: boolean;
}

interface ResourceEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly dispose: (value: T) => void;
  references: number;
  disposed: boolean;
}

/**
 * 按稳定 key 共享同步创建的只读资源；每个消费者持有独立幂等 lease。
 * 最后一个 lease 释放后才 dispose；pool.dispose() 用于所有者关闭时强制清空。
 */
export class SharedResourcePool<T> {
  private readonly entries = new Map<string, ResourceEntry<T>>();
  private closed = false;

  acquire(key: string, create: () => T, dispose: (value: T) => void): SharedResourceLease<T> {
    if (this.closed) throw new Error('共享资源池已关闭');
    if (key.trim().length === 0) throw new RangeError('共享资源 key 不能为空');

    let entry = this.entries.get(key);
    if (!entry) {
      const value = create();
      entry = { key, value, dispose, references: 0, disposed: false };
      this.entries.set(key, entry);
    }
    entry.references++;
    let released = false;
    return {
      value: entry.value,
      release: () => {
        if (released) return false;
        released = true;
        if (entry!.disposed) return false;
        entry!.references--;
        if (entry!.references === 0) {
          this.entries.delete(entry!.key);
          entry!.disposed = true;
          entry!.dispose(entry!.value);
        }
        return true;
      },
    };
  }

  referenceCount(key: string): number {
    return this.entries.get(key)?.references ?? 0;
  }

  snapshot(): SharedResourcePoolSnapshot {
    let leases = 0;
    for (const entry of this.entries.values()) leases += entry.references;
    return { resources: this.entries.size, leases, closed: this.closed };
  }

  /** 所有者生命周期结束时强制释放所有 entry；既有 lease 之后 release 为 no-op。 */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    let firstError: unknown;
    let failed = false;
    for (const [key, entry] of this.entries) {
      this.entries.delete(key);
      if (entry.disposed) continue;
      entry.disposed = true;
      entry.references = 0;
      try {
        entry.dispose(entry.value);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }
}
