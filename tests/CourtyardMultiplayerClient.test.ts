import { afterEach, describe, expect, it, vi } from 'vitest';
import { MULTIPLAYER } from '@/01-shared';
import { CourtyardMultiplayerClient, courtyardMultiplayerUrl } from '@/03-platform';

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static instance: FakeSocket;
  readyState = FakeSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: string[] = [];

  constructor() {
    super();
    FakeSocket.instance = this;
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSING;
    this.dispatchEvent(new Event('close'));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

function connect() {
  vi.stubGlobal('WebSocket', FakeSocket);
  const status = vi.fn();
  const snapshot = vi.fn();
  const client = new CourtyardMultiplayerClient('ws://127.0.0.1', status, snapshot);
  return { client, status, snapshot, socket: FakeSocket.instance };
}

afterEach(() => {
  FakeSocket.instance?.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('courtyard multiplayer client', () => {
  it('opts in only at an allowed development origin with the explicit flag', () => {
    const origin = 'http://127.0.0.1:5173';
    expect(courtyardMultiplayerUrl('?multiplayer=1&server=example.test', origin)).toBe(
      'ws://127.0.0.1:8787/multiplayer',
    );
    expect(courtyardMultiplayerUrl('?multiplayer=0', origin)).toBeNull();
    expect(courtyardMultiplayerUrl('?scene=courtyard', origin)).toBeNull();
    expect(courtyardMultiplayerUrl('?multiplayer=1', 'null')).toBeNull();
    expect(courtyardMultiplayerUrl('?multiplayer=1', 'http://localhost:4173')).toBeNull();
  });

  it('uses the same host and port only for the configured LAN origin', () => {
    const origin = 'http://192.168.100.27:5173';
    expect(courtyardMultiplayerUrl('?multiplayer=1', origin, origin)).toBe(
      'ws://192.168.100.27:5173/multiplayer',
    );
    expect(courtyardMultiplayerUrl('?multiplayer=1', origin)).toBeNull();
    expect(courtyardMultiplayerUrl('?multiplayer=1', `${origin}0`, origin)).toBeNull();
    expect(courtyardMultiplayerUrl('?server=example.test', origin, origin)).toBeNull();
  });

  it('waits for welcome and sends changed poses no faster than the network tick', () => {
    const { client, status, socket } = connect();
    const fromSpawn = { ...MULTIPLAYER.spawn, x: 0.2 };
    client.update(0, fromSpawn, 0);
    expect(socket.sent).toHaveLength(0);
    socket.receive({ type: 'welcome', id: '1' });
    expect(status.mock.calls).toEqual([['connecting'], ['online']]);
    client.update(0, fromSpawn, 0);
    client.update(1, fromSpawn, 1);
    client.update(100, fromSpawn, 0);
    client.update(100, fromSpawn, Math.PI + 0.1);
    const sent = socket.sent.map((message) => JSON.parse(message));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ type: 'move', seq: 0, ...fromSpawn, yaw: 0 });
    expect(sent[1]).toMatchObject({ type: 'move', seq: 1, x: fromSpawn.x });
    expect(sent[1].yaw).toBeCloseTo(-Math.PI + 0.1);
    socket.close();
    expect(status).toHaveBeenLastCalledWith('offline');
  });

  it('applies ordered deltas and disconnects on an invalid snapshot', () => {
    const { status, snapshot, socket } = connect();
    socket.receive({ type: 'welcome', id: '1' });
    const delta = {
      type: 'snapshot',
      tick: 2,
      changed: [{ id: '2', ...MULTIPLAYER.spawn }],
      removed: [],
    };
    socket.receive(delta);
    socket.receive({ ...delta, tick: 1 });
    expect(snapshot.mock.calls).toEqual([[delta]]);
    socket.receive({ ...delta, tick: 3, removed: ['2'] });
    expect(status).toHaveBeenLastCalledWith('offline');
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a full room from handshake timeout', () => {
    vi.useFakeTimers();
    const full = connect();
    full.socket.receive({ type: 'rejected', reason: 'room-full' });
    vi.advanceTimersByTime(MULTIPLAYER.connectTimeoutMs);
    expect(full.status.mock.calls).toEqual([['connecting'], ['room-full']]);
    const stalled = connect();
    vi.advanceTimersByTime(MULTIPLAYER.connectTimeoutMs);
    expect(stalled.status.mock.calls).toEqual([['connecting'], ['offline']]);
  });
});
