import { describe, expect, it, vi } from 'vitest';
import { LandCellResourceScope, SharedResourcePool } from '@/02-core';

describe('分区加载阶段 4 · cell 资源作用域', () => {
  it('先释放 cell 独占几何，再归还共享材质 lease', () => {
    const order: string[] = [];
    const pool = new SharedResourcePool<{ readonly id: string }>();
    const lease = pool.acquire(
      'material:stone',
      () => ({ id: 'stone' }),
      () => order.push('shared-material'),
    );
    const scope = new LandCellResourceScope();
    expect(scope.use(lease)).toBe(lease.value);
    scope.own({ id: 'cell-geometry' }, () => order.push('local-geometry'));
    expect(scope.snapshot()).toEqual({ localResources: 1, sharedLeases: 1, disposed: false });

    scope.dispose();
    scope.dispose();
    expect(order).toEqual(['local-geometry', 'shared-material']);
    expect(scope.snapshot()).toEqual({ localResources: 0, sharedLeases: 0, disposed: true });
    expect(lease.release()).toBe(false);
  });

  it('按逆序释放本地资源，即使某个销毁器失败也继续清理', () => {
    const order: string[] = [];
    const scope = new LandCellResourceScope();
    scope.own('first', () => order.push('first'));
    scope.own('broken', () => {
      order.push('broken');
      throw new Error('geometry dispose failed');
    });
    scope.own('last', () => order.push('last'));

    expect(() => scope.dispose()).toThrow('geometry dispose failed');
    expect(order).toEqual(['last', 'broken', 'first']);
    expect(scope.snapshot().disposed).toBe(true);
  });

  it('重复转交同一 lease 只登记一次，作用域销毁时共享资源仍由其他 cell 持有', () => {
    const dispose = vi.fn();
    const pool = new SharedResourcePool<{ readonly id: string }>();
    const firstCellLease = pool.acquire('geometry:shared', () => ({ id: 'tree' }), dispose);
    const secondCellLease = pool.acquire('geometry:shared', () => ({ id: 'tree' }), dispose);
    const scope = new LandCellResourceScope();
    scope.use(firstCellLease);
    scope.use(firstCellLease);
    expect(scope.snapshot().sharedLeases).toBe(1);

    scope.dispose();
    expect(pool.referenceCount('geometry:shared')).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    secondCellLease.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('释放后的 scope 拒绝接收本地资源或共享租约', () => {
    const scope = new LandCellResourceScope();
    const pool = new SharedResourcePool<string>();
    const lease = pool.acquire('shared', () => 'resource', vi.fn());
    scope.dispose();
    expect(() => scope.own('local', vi.fn())).toThrow('cell 资源作用域已释放');
    expect(() => scope.use(lease)).toThrow('cell 资源作用域已释放');
    lease.release();
    pool.dispose();
  });
});
