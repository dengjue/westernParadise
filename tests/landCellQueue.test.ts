import { describe, expect, it, vi } from 'vitest';
import { LandCellQueue } from '@/02-core';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

describe('分区加载阶段 4 · 有界异步 cell 队列', () => {
  it('去重相同 cell 请求，只执行一次构建并缓存 ready 结果', async () => {
    const build = deferred<{ readonly id: string }>();
    const load = vi.fn(() => build.promise);
    const queue = new LandCellQueue({ maxConcurrent: 2, maxPending: 4, dispose: vi.fn() });
    const first = queue.request('2,3', 10, load);
    const second = queue.request('2,3', 1, load);
    await flushPromises();
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    const cell = { id: '2,3' };
    build.resolve(cell);
    await expect(first).resolves.toBe(cell);
    expect(await queue.request('2,3', 0, load)).toBe(cell);
    expect(load).toHaveBeenCalledTimes(1);
    expect(queue.snapshot().ready).toBe(1);
    queue.dispose();
  });

  it('限制并发数并按优先级顺序启动排队 cell', async () => {
    const first = deferred<string>(),
      second = deferred<string>(),
      third = deferred<string>();
    const started: string[] = [];
    const queue = new LandCellQueue({ maxConcurrent: 1, maxPending: 2, dispose: vi.fn() });
    const pA = queue.request('a', 10, () => (started.push('a'), first.promise));
    const pB = queue.request('b', 2, () => (started.push('b'), second.promise));
    const pBPromoted = queue.request('b', 0, () => 'duplicate-loader-unused');
    const pC = queue.request('c', 1, () => (started.push('c'), third.promise));
    await flushPromises();
    expect(pBPromoted).toBe(pB);
    expect(started).toEqual(['a']);
    expect(queue.snapshot()).toMatchObject({ active: 1, loading: 1, pending: 2 });
    first.resolve('A');
    await expect(pA).resolves.toBe('A');
    await flushPromises();
    expect(started).toEqual(['a', 'b']);
    second.resolve('B');
    await expect(pB).resolves.toBe('B');
    await flushPromises();
    expect(started).toEqual(['a', 'b', 'c']);
    third.resolve('C');
    await expect(pC).resolves.toBe('C');
    queue.dispose();
  });

  it('待处理预算耗尽时替换最低优先级排队任务，拒绝更差请求', async () => {
    const loading = deferred<string>(),
      retained = deferred<string>();
    const queue = new LandCellQueue({ maxConcurrent: 1, maxPending: 1, dispose: vi.fn() });
    const pLoading = queue.request('active', 0, () => loading.promise);
    const pOld = queue.request('old', 12, () => Promise.resolve('old'));
    await flushPromises();
    const pNew = queue.request('new', 4, () => retained.promise);
    await expect(pOld).resolves.toBeNull();
    const rejected = await queue.request('worse', 8, () => Promise.resolve('worse'));
    expect(rejected).toBeNull();
    expect(queue.snapshot()).toMatchObject({ active: 1, pending: 1 });
    loading.resolve('active');
    await expect(pLoading).resolves.toBe('active');
    await flushPromises();
    retained.resolve('new');
    await expect(pNew).resolves.toBe('new');
    queue.dispose();
  });

  it('取消不响应 AbortSignal 的迟到结果，完成后释放而不重新挂回', async () => {
    const late = deferred<{ readonly id: string }>();
    const dispose = vi.fn();
    const queue = new LandCellQueue({ maxConcurrent: 1, maxPending: 2, dispose });
    let signal: AbortSignal | undefined;
    const request = queue.request('late', 0, (nextSignal) => {
      signal = nextSignal;
      return late.promise;
    });
    await flushPromises();
    expect(queue.unload('late')).toBe(true);
    expect(signal?.aborted).toBe(true);
    await expect(request).resolves.toBeNull();
    const value = { id: 'late' };
    late.resolve(value);
    await flushPromises();
    expect(dispose).toHaveBeenCalledWith(value);
    expect(queue.state('late')).toBeNull();
    expect(queue.snapshot().active).toBe(0);
  });

  it('失败状态可观测并允许显式重试；就绪载荷卸载时仅释放一次', async () => {
    const dispose = vi.fn();
    const queue = new LandCellQueue({ maxConcurrent: 1, maxPending: 1, dispose });
    const failure = new Error('temporary');
    const failed = queue.request('retry', 0, () => Promise.reject(failure));
    await expect(failed).rejects.toBe(failure);
    await flushPromises();
    expect(queue.state('retry')).toBe('error');
    const value = { id: 'retry' };
    await expect(queue.request('retry', 0, () => value)).resolves.toBe(value);
    expect(queue.state('retry')).toBe('ready');
    expect(queue.unload('retry')).toBe(true);
    expect(queue.unload('retry')).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(value);
  });

  it('队列销毁会取消未完成请求并拒绝未来请求', async () => {
    const pending = deferred<string>();
    const dispose = vi.fn();
    const queue = new LandCellQueue({ maxConcurrent: 1, maxPending: 1, dispose });
    let signal: AbortSignal | undefined;
    const request = queue.request('pending', 0, (nextSignal) => {
      signal = nextSignal;
      return pending.promise;
    });
    await flushPromises();
    queue.dispose();
    expect(signal?.aborted).toBe(true);
    await expect(request).resolves.toBeNull();
    expect(await queue.request('new', 0, () => 'new')).toBeNull();
    pending.resolve('stale');
    await flushPromises();
    expect(dispose).toHaveBeenCalledWith('stale');
  });

  it('销毁载荷失败时仍继续释放队列中的其他 ready cell', async () => {
    const failure = new Error('dispose failed');
    const disposed: string[] = [];
    const queue = new LandCellQueue<string>({
      maxConcurrent: 2,
      maxPending: 2,
      dispose: (value) => {
        disposed.push(value);
        if (value === 'broken') throw failure;
      },
    });
    await Promise.all([queue.request('a', 0, () => 'broken'), queue.request('b', 1, () => 'safe')]);

    expect(() => queue.dispose()).toThrow(failure);
    expect(disposed).toEqual(['broken', 'safe']);
    expect(queue.snapshot()).toMatchObject({ ready: 0, active: 0, pending: 0 });
  });
});
