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
  it('分配 30 个不同的地面入口点，释放后可复用', () => {
    const room = new MultiplayerRoom(() => 0, 30, true);
    const seats = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const entry = room.join();
      if (entry.type !== 'welcome' || !entry.spawn) throw Error('缺少入口位置');
      seats.add(`${entry.spawn.x},${entry.spawn.z}`);
    }
    expect(seats.size).toBe(30);
    room.leave('1');
    expect(room.join()).toMatchObject({ type: 'welcome', spawn: { x: 0, z: 85 } });
  });

  it('keeps one observed role through takeoff, cruise, and landing and rejects altitude jumps', () => {
    let now = 0;
    const room = new MultiplayerRoom(() => now, 2, true);
    const a = room.join(),
      b = room.join();
    if (a.type !== 'welcome' || b.type !== 'welcome') throw new Error('room full');
    const ground = room.collectSnapshots().get(a.id)!.changed[0]!;
    let seq = 0;
    const send = (height: number, flying: boolean, x = ground.x) => {
      now += 100;
      return room.move(b.id, {
        ...ground,
        type: 'move',
        seq: seq++,
        y: height,
        x,
        ...(flying ? { flying: true } : {}),
      });
    };
    expect(send(48, true)).toBe(false);
    expect(send(ground.y + 0.5, true)).toBe(true);
    expect(send(ground.y + 1, true, 0.5)).toBe(false);
    for (let y = ground.y + 1; y < 43; y += 0.5) expect(send(y, true)).toBe(true);
    expect(send(43, true, 0.5)).toBe(true);
    expect(send(65, true)).toBe(false);
    expect(send(ground.y, false)).toBe(false);
    expect(room.collectSnapshots().get(a.id)).toMatchObject({
      changed: [{ id: b.id, y: 43, flying: true }],
      removed: [],
    });
    for (let y = 42.5; y > ground.y; y -= 0.5) expect(send(y, true, 0.5)).toBe(true);
    expect(send(ground.y, false, 0.5)).toBe(true);
    expect(room.collectSnapshots().get(a.id)!.changed[0]).toEqual({ ...ground, x: 0.5 });
  });

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
