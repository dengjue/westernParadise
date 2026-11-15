import { describe, expect, it, vi } from 'vitest';
import { SharedResourcePool } from '@/02-core';

describe('分区加载阶段 4 · 共享资源租约', () => {
  it('跨 cell 共享同一资源，最后一个 lease 释放时只 dispose 一次', () => {
    const pool = new SharedResourcePool<{ readonly id: string }>();
    const create = vi.fn(() => ({ id: 'material:stone' }));
    const dispose = vi.fn();
    const first = pool.acquire('material:stone', create, dispose);
    const second = pool.acquire('material:stone', create, dispose);

    expect(first.value).toBe(second.value);
    expect(create).toHaveBeenCalledTimes(1);
    expect(pool.referenceCount('material:stone')).toBe(2);
    expect(first.release()).toBe(true);
    expect(first.release()).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(second.release()).toBe(true);
    expect(second.release()).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(first.value);
    expect(pool.snapshot()).toMatchObject({ resources: 0, leases: 0, closed: false });
  });

  it('按 key 隔离资源，并在引用归零后允许重新创建', () => {
    const pool = new SharedResourcePool<{ readonly key: string }>();
    const dispose = vi.fn();
    const stone = pool.acquire('material:stone', () => ({ key: 'stone' }), dispose);
    const jade = pool.acquire('material:jade', () => ({ key: 'jade' }), dispose);
    expect(stone.value).not.toBe(jade.value);
    expect(pool.snapshot()).toEqual({ resources: 2, leases: 2, closed: false });

    stone.release();
    const replacement = pool.acquire('material:stone', () => ({ key: 'new-stone' }), dispose);
    expect(replacement.value.key).toBe('new-stone');
    expect(pool.referenceCount('material:stone')).toBe(1);
    jade.release();
    replacement.release();
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it('factory 抛错不留下半初始化 entry，后续请求可重试', () => {
    const pool = new SharedResourcePool<string>();
    const dispose = vi.fn();
    expect(() =>
      pool.acquire(
        'texture:pond',
        () => {
          throw new Error('decode');
        },
        dispose,
      ),
    ).toThrow('decode');
    expect(pool.snapshot()).toEqual({ resources: 0, leases: 0, closed: false });
    const lease = pool.acquire('texture:pond', () => 'pond-texture', dispose);
    expect(lease.value).toBe('pond-texture');
    lease.release();
    expect(dispose).toHaveBeenCalledWith('pond-texture');
  });

  it('pool 关闭会强制释放一次，既有 lease 不会二次释放且不能再 acquire', () => {
    const pool = new SharedResourcePool<{ disposeCount: number }>();
    const dispose = vi.fn((value: { disposeCount: number }) => value.disposeCount++);
    const first = pool.acquire('geometry:arch', () => ({ disposeCount: 0 }), dispose);
    const second = pool.acquire('geometry:arch', () => ({ disposeCount: 0 }), dispose);

    pool.dispose();
    pool.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(first.value.disposeCount).toBe(1);
    expect(first.release()).toBe(false);
    expect(second.release()).toBe(false);
    expect(pool.snapshot()).toEqual({ resources: 0, leases: 0, closed: true });
    expect(() => pool.acquire('new', () => ({ disposeCount: 0 }), vi.fn())).toThrow(
      '共享资源池已关闭',
    );
  });

  it('拒绝空 key', () => {
    const pool = new SharedResourcePool<string>();
    expect(() => pool.acquire('  ', () => 'x', vi.fn())).toThrow(RangeError);
  });

  it('一个资源销毁器报错时仍释放剩余 entry', () => {
    const pool = new SharedResourcePool<string>();
    const failure = new Error('dispose failed');
    const firstDispose = vi.fn(() => {
      throw failure;
    });
    const secondDispose = vi.fn();
    pool.acquire('first', () => 'first', firstDispose);
    pool.acquire('second', () => 'second', secondDispose);

    expect(() => pool.dispose()).toThrow(failure);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledWith('second');
    expect(pool.snapshot()).toEqual({ resources: 0, leases: 0, closed: true });
  });
});
