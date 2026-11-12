import { describe, expect, it } from 'vitest';
import type { AppEventMap } from '@/00-types';
import { EventBus } from '@/02-core';

describe('EventBus', () => {
  it('订阅后能收到载荷，退订后不再收到', () => {
    const bus = new EventBus<AppEventMap>();
    const received: number[] = [];
    const off = bus.on('app:ready', (payload) => {
      received.push(payload.startedAt);
    });

    bus.emit('app:ready', { startedAt: 123 });
    expect(received).toEqual([123]);
    expect(bus.size).toBe(1);

    off();
    bus.emit('app:ready', { startedAt: 456 });
    expect(received).toEqual([123]);
    expect(bus.size).toBe(0);
  });

  it('同一事件多个订阅者按注册顺序收到', () => {
    const bus = new EventBus<AppEventMap>();
    const order: string[] = [];
    bus.on('app:ready', () => {
      order.push('a');
    });
    bus.on('app:ready', () => {
      order.push('b');
    });
    bus.emit('app:ready', { startedAt: 1 });
    expect(order).toEqual(['a', 'b']);
  });

  it('单个订阅者抛错被隔离，不影响其他订阅者', () => {
    const errors: unknown[] = [];
    const bus = new EventBus<AppEventMap>({ onError: (error) => errors.push(error) });
    const received: number[] = [];
    bus.on('app:ready', () => {
      throw new Error('订阅者故障');
    });
    bus.on('app:ready', (payload) => {
      received.push(payload.startedAt);
    });

    expect(() => bus.emit('app:ready', { startedAt: 7 })).not.toThrow();
    expect(received).toEqual([7]);
    expect(errors).toHaveLength(1);
  });

  it('派发过程中退订不抛错，clear 能清空全部订阅', () => {
    const bus = new EventBus<AppEventMap>();
    const off = bus.on('app:ready', () => undefined);
    const handler = () => undefined;
    bus.on('app:ready', handler);
    bus.on('app:ready', () => {
      off();
      bus.off('app:ready', handler);
    });

    expect(() => bus.emit('app:ready', { startedAt: 1 })).not.toThrow();
    bus.clear();
    expect(bus.size).toBe(0);
  });
});
