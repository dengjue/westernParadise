import { on, once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { MultiplayerSnapshot, MultiplayerWelcome } from '@/00-types';
import { MULTIPLAYER } from '@/01-shared';
import { createMultiplayerServer, MULTIPLAYER_LOCAL } from '@/99-boot/multiplayerServer';

const origin = MULTIPLAYER_LOCAL.allowedOrigins[0];
let server: ReturnType<typeof createMultiplayerServer> | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startServer(capacity?: number) {
  server = createMultiplayerServer(capacity === undefined ? {} : { capacity });
  const port = await server.listen(0);
  return `ws://${MULTIPLAYER_LOCAL.host}:${port}${MULTIPLAYER_LOCAL.path}`;
}

function connect(url: string) {
  const socket = new WebSocket(url, { origin });
  const messages = on(socket, 'message', { close: ['close'] });
  return {
    socket,
    async next(): Promise<MultiplayerSnapshot | MultiplayerWelcome> {
      const result = await messages.next();
      if (result.done) throw new Error('Socket closed before next message');
      return JSON.parse(String(result.value[0])) as MultiplayerSnapshot | MultiplayerWelcome;
    },
  };
}

describe('local multiplayer WebSocket', () => {
  it('syncs movement across two sockets, rejects a third, and frees disconnected seats', async () => {
    const url = await startServer(2);
    const a = connect(url);
    const b = connect(url);
    const aWelcome = await a.next();
    const bWelcome = await b.next();
    if (aWelcome.type !== 'welcome' || bWelcome.type !== 'welcome') {
      throw new Error('Expected two admitted connections');
    }
    expect(await a.next()).toMatchObject({ type: 'snapshot', changed: [{ id: bWelcome.id }] });
    expect(await b.next()).toMatchObject({ type: 'snapshot', changed: [{ id: aWelcome.id }] });
    b.socket.send(JSON.stringify({ type: 'move', seq: 0, ...MULTIPLAYER.spawn, x: 0.5 }));
    expect(await a.next()).toMatchObject({
      type: 'snapshot',
      changed: [{ id: bWelcome.id, x: 0.5 }],
    });

    const c = connect(url);
    const cClosed = once(c.socket, 'close');
    expect(await c.next()).toEqual({ type: 'rejected', reason: 'room-full' });
    expect((await cClosed)[0]).toBe(1008);

    b.socket.close();
    expect(await a.next()).toMatchObject({ type: 'snapshot', changed: [], removed: [bWelcome.id] });
    const d = connect(url);
    expect(await d.next()).toMatchObject({ type: 'welcome' });
  });

  it('rejects a disallowed or missing browser Origin', async () => {
    const url = await startServer();
    for (const blockedOrigin of ['https://example.test', undefined]) {
      const socket = new WebSocket(url, { origin: blockedOrigin });
      const [error] = await once(socket, 'error');
      expect(error.message).toMatch(/Unexpected server response: 401/);
    }
  });

  it.each([
    ['binary', new Uint8Array([42]), 1003],
    ['invalid JSON', '{', 1007],
    ['oversize', ' '.repeat(MULTIPLAYER_LOCAL.maxMessageBytes + 1), 1009],
  ])('closes %s messages and frees the seat', async (_label, payload, code) => {
    const url = await startServer(1);
    const client = connect(url);
    expect(await client.next()).toMatchObject({ type: 'welcome' });
    const closed = once(client.socket, 'close');
    client.socket.send(payload);
    expect((await closed)[0]).toBe(code);
    const replacement = connect(url);
    expect(await replacement.next()).toMatchObject({ type: 'welcome' });
  });
});
