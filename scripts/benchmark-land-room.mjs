// 编译为单个 Node CJS 后运行；房间与模拟玩家分进程，不占用测试服席位。
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createMultiplayerServer } from '../src/99-boot/multiplayerServer.ts';
import { sampleLandHeight } from '../src/02-core/landNavigation.ts';

async function server() {
  const room = createMultiplayerServer();
  process.on('disconnect', () => void room.close());
  process.on('message', () =>
    process.send({ cpu: process.cpuUsage(), rss: process.memoryUsage.rss() }),
  );
  process.send(await room.listen(0));
}

async function run(count, spread) {
  const child = fork(process.argv[1], ['--serve'], { execArgv: [] });
  const players = [];
  const gaps = [];
  let measuring = false;
  let disconnected = 0;
  try {
    const [port] = await once(child, 'message');
    const stats = async () => {
      const pending = once(child, 'message');
      child.send('sample');
      return (await pending)[0];
    };
    for (let i = 0; i < count; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/multiplayer?world=land`, {
        origin: 'http://127.0.0.1:5173',
      });
      const player = { ws, seq: 0, x: 0, last: 0, snapshots: 0 };
      players.push(player);
      ws.on('close', () => {
        if (measuring) disconnected++;
      });
      ws.on('message', (raw) => {
        const message = JSON.parse(raw);
        if (message.type === 'rejected') throw new Error('unexpected rejection');
        if (message.type !== 'snapshot' || !measuring) return;
        const now = performance.now();
        if (player.last) gaps.push(now - player.last);
        player.last = now;
        player.snapshots++;
      });
      const [welcome] = await once(ws, 'message');
      player.spawn = JSON.parse(welcome).spawn;
    }
    const update = (p, x, z = 85) => {
      const y = sampleLandHeight(x, z, true);
      assert.notEqual(y, null);
      p.ws.send(JSON.stringify({ type: 'move', seq: p.seq++, x, y, z, yaw: 0 }));
    };
    // 分成左右两个相隔 70m 的人群；每人实际走到目标，避免绕开速度校验。
    {
      const steps = spread ? 70 : 24;
      for (let i = 1; i <= steps; i++) {
        for (const [index, p] of players.entries()) {
          const dest = spread ? (index % 2 ? -35 : 35) : 0;
          p.x = p.spawn.x + ((dest - p.spawn.x) * i) / steps;
          update(p, p.x, p.spawn.z + ((85 - p.spawn.z) * i) / steps);
        }
        await delay(100);
      }
    }
    const bytes = () =>
      players.reduce(
        ([up, down], p) => [up + p.ws._socket.bytesWritten, down + p.ws._socket.bytesRead],
        [0, 0],
      );
    const before = bytes();
    const initial = await stats();
    const start = performance.now();
    measuring = true;
    for (let i = 0; i < 100; i++) {
      for (const [index, p] of players.entries()) update(p, p.x + Math.sin(i / 5 + index));
      await delay(100);
    }
    measuring = false;
    const seconds = (performance.now() - start) / 1000;
    const final = await stats();
    const after = bytes();
    gaps.sort((a, b) => a - b);
    assert.equal(disconnected, 0);
    if (!spread || count > 2)
      assert.ok(
        players.every((p) => p.snapshots > 75),
        'missing neighbor updates',
      );
    const wasted = final.cpu.user + final.cpu.system - initial.cpu.user - initial.cpu.system;
    console.log(
      JSON.stringify({
        count,
        layout: spread ? 'split' : 'crowd',
        seconds: +seconds.toFixed(2),
        upKBps: +((after[0] - before[0]) / seconds / 1000).toFixed(1),
        downKBps: +((after[1] - before[1]) / seconds / 1000).toFixed(1),
        cpuPercent: +(wasted / seconds / 10000).toFixed(1),
        rssMiB: +(final.rss / 1048576).toFixed(1),
        deliveryGapP95Ms: gaps.length ? +gaps[Math.ceil(gaps.length * 0.95) - 1].toFixed(1) : null,
        disconnected,
      }),
    );
  } finally {
    for (const p of players) p.ws.terminate();
    child.kill();
  }
}

async function main() {
  if (process.argv.includes('--serve')) return server();
  for (const count of [2, 10, 30]) for (const spread of [false, true]) await run(count, spread);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
