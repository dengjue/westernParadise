/** 为专用回环房间提供 5 或 15 个移动角色；不向共享测试服务器发送负载。 */
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const count = Number(process.argv[2]);
if (![5, 15].includes(count)) throw new Error('需要 5 或 15 个陪测角色');
const sockets = [];
try {
  for (let i = 0; i < count; i++) {
    const ws = new WebSocket('ws://127.0.0.1:8787/multiplayer?world=land', {
      origin: 'http://127.0.0.1:5173',
    });
    sockets.push(ws);
    const [message] = await once(ws, 'message');
    if (JSON.parse(message).type !== 'welcome') throw new Error('独立房间未接纳陪测角色');
  }
  // 从入口按合法速度走入镜头前的 5 列队形，此后沿 x 轴来回走动。
  for (let seq = 0; ; seq++) {
    const progress = Math.min(1, seq / 40);
    sockets.forEach((ws, i) => {
      const x = ((i % 5) - 2) * 0.9 * progress + Math.sin(seq / 6 + i) * 0.2 * progress;
      const z = 85 - (9 + Math.floor(i / 5) * 2) * progress;
      ws.send(
        JSON.stringify({
          type: 'move',
          seq,
          x,
          y: 1.3,
          z,
          yaw: Math.cos(seq / 6 + i) > 0 ? Math.PI / 2 : -Math.PI / 2,
        }),
      );
    });
    await delay(100);
  }
} finally {
  for (const ws of sockets) ws.terminate();
}
