import { WORLD } from './world';

export const MULTIPLAYER = Object.freeze({
  capacity: 30,
  tickMs: 100,
  enterRadius: 18,
  leaveRadius: 22,
  maxNeighbors: 15,
  bounds: WORLD.bounds,
  spawn: Object.freeze({
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
});
