import { WORLD } from './world';

export const MULTIPLAYER_ENDPOINT = /* @__PURE__ */ Object.freeze({
  host: '127.0.0.1',
  port: 8787,
  webPort: 5173,
  path: '/multiplayer',
  allowedOrigins: /* @__PURE__ */ Object.freeze(['http://127.0.0.1:5173', 'http://localhost:5173']),
});

export const MULTIPLAYER = /* @__PURE__ */ Object.freeze({
  capacity: 30,
  tickMs: 100,
  enterRadius: 18,
  leaveRadius: 22,
  maxNeighbors: 15,
  bounds: WORLD.bounds,
  spawn: /* @__PURE__ */ Object.freeze({
    x: WORLD.spawn.x,
    y: 0,
    z: WORLD.spawn.z,
    yaw: (WORLD.spawn.yawDeg * Math.PI) / 180,
  }),
  minY: 0,
  maxY: WORLD.scene.platform.height,
  maxYaw: Math.PI,
  // 允许步态采样与网络节拍错位，但空闲期间不能无限囤积位移。
  maxSpeed: WORLD.player.walkSpeed * 1.5,
  moveBurstMs: 350,
  movesPerSecond: 15,
  messageBurst: 3,
  connectTimeoutMs: 3000,
  maxSnapshotChars: 8192,
  maxClientQueueBytes: 512,
});
