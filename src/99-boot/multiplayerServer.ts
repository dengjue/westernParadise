import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { MULTIPLAYER, MULTIPLAYER_ENDPOINT } from '@/01-shared';
import { MultiplayerRoom } from '@/02-core';

export const MULTIPLAYER_LOCAL = Object.freeze({
  ...MULTIPLAYER_ENDPOINT,
  maxMessageBytes: 512,
  maxQueuedBytes: 32 * 1024,
  heartbeatMs: 15_000,
});

interface Connection {
  socket: WebSocket;
  alive: boolean;
}

/** 默认独立监听回环；静态测试站可显式在同一个私网 HTTP 端口接收联机。 */
export function createMultiplayerServer(
  options: {
    capacity?: number;
    lanOrigin?: string;
    site?: { host: string; request: RequestListener };
  } = {},
) {
  const channels = [false, true].map((land) => ({
    room: new MultiplayerRoom(() => performance.now(), options.capacity, land),
    connections: new Map<string, Connection>(),
  }));
  const server = createServer(
    options.site?.request ??
      ((_request, response) => {
        response.writeHead(404).end();
      }),
  );
  const wss = new WebSocketServer({
    server,
    path: MULTIPLAYER_LOCAL.path,
    maxPayload: MULTIPLAYER_LOCAL.maxMessageBytes,
    perMessageDeflate: false,
    verifyClient: ({ origin }: { origin?: string }) =>
      options.site
        ? origin !== undefined && origin === options.lanOrigin
        : MULTIPLAYER_LOCAL.allowedOrigins.some((value) => value === origin) ||
          (options.lanOrigin !== undefined && origin === options.lanOrigin),
  });

  const release = ({ connections, room }: (typeof channels)[number], id: string): void => {
    connections.delete(id);
    room.leave(id);
  };

  wss.on('connection', (socket, request) => {
    const channel = channels[request.url === `${MULTIPLAYER_LOCAL.path}?world=land` ? 1 : 0]!;
    const { room, connections } = channel;
    // 格式错误、超大报文或网络故障可能先发 error 再发 close，均释放房间席位。
    const admission = room.join();
    if (admission.type === 'rejected') {
      socket.on('error', () => socket.terminate());
      socket.send(JSON.stringify(admission));
      socket.close(1008, admission.reason);
      return;
    }
    const { id } = admission;
    const connection = { socket, alive: true };
    connections.set(id, connection);
    socket.on('close', () => release(channel, id));
    socket.on('error', () => release(channel, id));
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, isBinary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        release(channel, id);
        socket.close(1003, 'text required');
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        release(channel, id);
        socket.close(1007, 'invalid JSON');
        return;
      }
      room.move(id, message);
    });
    socket.send(JSON.stringify(admission));
  });

  const sync = setInterval(() => {
    for (const channel of channels) {
      const { room, connections } = channel;
      for (const [id, snapshot] of room.collectSnapshots()) {
        const connection = connections.get(id);
        if (!connection || connection.socket.readyState !== WebSocket.OPEN) continue;
        const message = JSON.stringify(snapshot);
        const { socket } = connection;
        // 快照是增量，不能丢一帧后继续发送。断开慢连接可避免无限积压，并强制重新入场。
        if (socket.bufferedAmount + Buffer.byteLength(message) > MULTIPLAYER_LOCAL.maxQueuedBytes) {
          release(channel, id);
          socket.terminate();
          continue;
        }
        socket.send(message);
      }
    }
  }, MULTIPLAYER.tickMs);
  const heartbeat = setInterval(() => {
    for (const channel of channels) {
      const { connections } = channel;
      for (const [id, connection] of connections) {
        if (!connection.alive) {
          release(channel, id);
          connection.socket.terminate();
        } else if (connection.socket.readyState === WebSocket.OPEN) {
          connection.alive = false;
          connection.socket.ping();
        }
      }
    }
  }, MULTIPLAYER_LOCAL.heartbeatMs);
  sync.unref();
  heartbeat.unref();

  return {
    listen(port: number = MULTIPLAYER_LOCAL.port): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, options.site?.host ?? MULTIPLAYER_LOCAL.host, () => {
          server.off('error', reject);
          const address = server.address();
          if (address && typeof address !== 'string') resolve(address.port);
          else reject(new Error('Missing multiplayer listening address'));
        });
      });
    },
    async close(): Promise<void> {
      clearInterval(sync);
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    },
  };
}
