import { describe, expect, it } from 'vitest';
import type { MultiplayerMove } from '@/00-types';
import { MULTIPLAYER } from '@/01-shared';
import { MultiplayerRoom } from '@/02-core';

function setup(capacity?: number) {
  let now = 0;
  const room = new MultiplayerRoom(() => now, capacity);
  return {
    room,
    advance(ms: number = MULTIPLAYER.tickMs) {
      now += ms;
    },
    join() {
      const result = room.join();
      if (result.type !== 'welcome') throw new Error('Expected a free slot');
      return result.id;
    },
  };
}

function move(seq: number, overrides: Partial<MultiplayerMove> = {}): MultiplayerMove {
  return { type: 'move', seq, ...MULTIPLAYER.spawn, ...overrides };
}

describe('MultiplayerRoom', () => {
  it('assigns unique IDs, caps capacity, and frees a slot on leave', () => {
    const { room, join } = setup(2);
    const first = join();
    const second = join();
    expect(first).not.toBe(second);
    expect(room.join()).toEqual({ type: 'rejected', reason: 'room-full' });
    expect(room.leave(first)).toBe(true);
    expect(room.leave(first)).toBe(false);
    expect(room.move(first, move(0))).toBe(false);
    expect(join()).not.toBe(first);
  });

  it('sends ordered deltas without echoing self or sending unchanged snapshots', () => {
    const { room, join } = setup();
    const first = join();
    expect(room.collectSnapshots().size).toBe(0);
    const second = join();
    const initial = room.collectSnapshots();
    expect(initial.get(first)).toEqual({
      type: 'snapshot',
      tick: 2,
      changed: [{ id: second, ...MULTIPLAYER.spawn }],
      removed: [],
    });
    expect(initial.get(second)?.changed[0]?.id).toBe(first);
    expect(room.move(second, move(0))).toBe(true);
    expect(room.collectSnapshots().size).toBe(0);

    expect(room.move(second, { ...move(1, { x: 0.5, yaw: 0 }), id: first })).toBe(true);
    const changed = room.collectSnapshots();
    expect(changed.size).toBe(1);
    expect(changed.get(first)).toMatchObject({
      tick: 4,
      changed: [{ id: second, x: 0.5, yaw: 0 }],
    });

    room.leave(second);
    expect(room.collectSnapshots().get(first)).toMatchObject({ changed: [], removed: [second] });
    expect(room.collectSnapshots().size).toBe(0);
  });

  it('rejects malformed messages, non-finite or out-of-map values, and stale sequences', () => {
    const { room, join, advance } = setup();
    const id = join();
    for (const invalid of [
      null,
      'move',
      { type: 'move', seq: 0 },
      { ...move(0), x: '0' },
      move(0, { x: NaN }),
      move(0, { y: Infinity }),
      move(0, { y: MULTIPLAYER.maxY + 1 }),
      move(0, { z: MULTIPLAYER.bounds.maxZ + 1 }),
      move(0, { yaw: Math.PI * 2 }),
      move(-1),
      move(0.5),
      move(Number.MAX_SAFE_INTEGER + 1),
    ]) {
      advance();
      expect(room.move(id, invalid)).toBe(false);
    }
    expect(room.move(id, move(2))).toBe(true);
    advance();
    expect(room.move(id, move(1))).toBe(false);
    expect(room.move(id, move(2))).toBe(false);
    advance();
    expect(room.move(id, move(3))).toBe(true);
  });

  it('rate-limits even invalid messages and refills the budget over time', () => {
    const { room, join, advance } = setup();
    const id = join();
    for (let i = 0; i < MULTIPLAYER.messageBurst; i++) {
      expect(room.move(id, {})).toBe(false);
    }
    expect(room.move(id, move(0))).toBe(false);
    advance();
    expect(room.move(id, move(0))).toBe(true);
  });

  it('limits cumulative movement and does not bank unlimited distance while idle', () => {
    const { room, join, advance } = setup();
    const id = join();
    expect(room.move(id, move(0, { x: 1 }))).toBe(true);
    expect(room.move(id, move(1, { x: 2 }))).toBe(false);
    advance(250);
    expect(room.move(id, move(1, { x: 2 }))).toBe(true);
    advance(60_000);
    expect(room.move(id, move(2, { x: 10 }))).toBe(false);
    expect(room.move(id, move(2, { x: 3, y: MULTIPLAYER.maxY }))).toBe(true);
  });

  it('keeps existing neighbors until the exit radius and requires the entry radius to return', () => {
    const { room, join, advance } = setup();
    const observer = join();
    const walker = join();
    let z: number = MULTIPLAYER.spawn.z;
    let seq = 0;
    const walkTo = (target: number) => {
      while (z !== target) {
        advance(250);
        z += Math.sign(target - z);
        expect(room.move(walker, move(seq++, { z }))).toBe(true);
      }
      return room.collectSnapshots().get(observer);
    };
    expect(room.collectSnapshots().get(observer)?.changed[0]?.id).toBe(walker);
    expect(walkTo(-6)?.changed[0]?.id).toBe(walker); // 距离 20，已在视野内。
    expect(walkTo(-9)?.removed).toEqual([walker]); // 距离 23。
    expect(walkTo(-6)).toBeUndefined(); // 距离 20，不足以重新进入。
    expect(walkTo(-4)?.changed[0]?.id).toBe(walker); // 距离 18，跨网格重新进入。
  });

  it('caps neighbors in a crowd with stable ties and replaces one when a player gets closer', () => {
    const { room, join, advance } = setup();
    const observer = join();
    expect(room.move(observer, move(0, { x: 1 }))).toBe(true);
    const neighbors = Array.from({ length: MULTIPLAYER.maxNeighbors + 1 }, () => join());
    const initial = room.collectSnapshots().get(observer);
    expect(initial?.changed.map(({ id }) => id)).toEqual(neighbors.slice(0, -1));
    const last = neighbors.at(-1)!;
    advance();
    expect(room.move(last, move(0, { x: 1 }))).toBe(true);
    expect(room.collectSnapshots().get(observer)).toMatchObject({
      changed: [{ id: last }],
      removed: [neighbors.at(-2)],
    });
  });
});
