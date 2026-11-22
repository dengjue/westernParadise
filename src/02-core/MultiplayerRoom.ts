import type {
  MultiplayerPlayer,
  MultiplayerPose,
  MultiplayerSnapshot,
  MultiplayerWelcome,
} from '@/00-types';
import { MULTIPLAYER, LAND_JOURNEY, LAND_FLIGHT, LAND_PEERS } from '@/01-shared';
import { sampleLandHeight } from './landNavigation';
import { parseMultiplayerMove } from './multiplayerProtocol';

interface Session {
  population: number;
  player: MultiplayerPlayer;
  seen: Map<string, MultiplayerPlayer>;
  seq: number;
  sampledAt: number;
  messageBudget: number;
  distanceBudget: number;
  climbBudget: number;
}

const GRID_SIZE = MULTIPLAYER.leaveRadius;
const CLIMB_SPEED = LAND_FLIGHT.verticalSpeed * 1.5;
const CLIMB_BURST = (CLIMB_SPEED * MULTIPLAYER.moveBurstMs) / 1000;
const AIR_SPEED = LAND_FLIGHT.horizontalSpeed * 1.5;

/**
 * 单房间状态，不持有连接、计时器或浏览器对象。调用方绑定连接与 ID，
 * 注入单调时钟，并按 MULTIPLAYER.tickMs 调用 collectSnapshots。
 */
export class MultiplayerRoom {
  private readonly sessions = new Map<string, Session>();
  private nextId = 1;
  private tick = 0;
  private dirty = false;
  private readonly speed: number;
  private readonly burstDistance: number;
  private readonly spawn: MultiplayerPose;

  constructor(
    private readonly now: () => number,
    private readonly capacity: number = MULTIPLAYER.capacity,
    private readonly land = false,
  ) {
    this.speed = land ? LAND_JOURNEY.walkSpeed * 1.5 : MULTIPLAYER.maxSpeed;
    this.burstDistance = (this.speed * MULTIPLAYER.moveBurstMs) / 1000;
    const [x, z] = LAND_JOURNEY.entries[0];
    this.spawn = land
      ? { x, z, y: sampleLandHeight(x, z, true)!, yaw: Math.PI }
      : MULTIPLAYER.spawn;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Invalid multiplayer room capacity');
    }
  }

  join(): MultiplayerWelcome {
    if (this.sessions.size >= this.capacity) {
      return { type: 'rejected', reason: 'room-full' };
    }
    const spawn = this.land ? this.findEntrance() : this.spawn;
    if (!spawn) return { type: 'rejected', reason: 'room-full' };
    const id = String(this.nextId++);
    this.sessions.set(id, {
      population: this.sessions.size + 1,
      player: Object.freeze({ id, ...spawn }),
      seen: new Map(),
      seq: -1,
      sampledAt: this.now(),
      messageBudget: MULTIPLAYER.messageBurst,
      distanceBudget: this.burstDistance,
      climbBudget: CLIMB_BURST,
    });
    this.dirty = true;
    return this.land
      ? { type: 'welcome', id, spawn, population: this.sessions.size }
      : { type: 'welcome', id };
  }

  private findEntrance(): MultiplayerPose | undefined {
    // 从中心向两侧展开，再向中轴内侧换行；按现有位置选位而非永久占用出生点。
    for (let i = 0; i < Math.max(this.capacity, MULTIPLAYER.capacity) * 2; i++) {
      const col = i % LAND_PEERS.spawnColumns;
      const x = this.spawn.x + Math.ceil(col / 2) * (col % 2 ? 1 : -1) * LAND_PEERS.spawnSpacing;
      const z = this.spawn.z - Math.floor(i / LAND_PEERS.spawnColumns) * LAND_PEERS.spawnSpacing;
      const y = sampleLandHeight(x, z, true);
      if (y === null) continue;
      let free = true;
      for (const { player } of this.sessions.values()) {
        if (
          Math.abs(player.y - y) < LAND_PEERS.height &&
          Math.hypot(x - player.x, z - player.z) < LAND_PEERS.distance
        ) {
          free = false;
          break;
        }
      }
      if (free) return { x, y, z, yaw: this.spawn.yaw };
    }
    return undefined;
  }

  leave(id: string): boolean {
    if (!this.sessions.delete(id)) return false;
    this.dirty = true;
    return true;
  }

  /** 来源 ID 必须由传输层绑定，不能从客户端消息中提取。 */
  move(id: string, payload: unknown): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // 两个独立令牌桶分别约束消息频率和累计水平位移；
    // 固定宽容值若每包都重新给，会变成可通过频繁发包绕过的速度上限。
    const now = this.now();
    const dt = Math.max(0, now - session.sampledAt) / 1000;
    session.sampledAt = now;
    session.messageBudget = Math.min(
      MULTIPLAYER.messageBurst,
      session.messageBudget + dt * MULTIPLAYER.movesPerSecond,
    );
    const speed = session.player.flying ? AIR_SPEED : this.speed;
    session.distanceBudget = Math.min(
      (speed * MULTIPLAYER.moveBurstMs) / 1000,
      session.distanceBudget + dt * speed,
    );
    session.climbBudget = Math.min(CLIMB_BURST, session.climbBudget + dt * CLIMB_SPEED);
    if (session.messageBudget < 1) return false;
    session.messageBudget -= 1;

    const move = parseMultiplayerMove(payload, this.land);
    if (!move || move.seq <= session.seq) return false;
    const player = session.player;
    // 台基的 Y 坐标可能一步切换，水平位移查速度，高度单独查合法范围。
    const distance = Math.hypot(player.x - move.x, player.z - move.z);
    if (distance > session.distanceBudget) return false;
    if (move.flying || player.flying) {
      const climb = Math.abs(player.y - move.y);
      if (climb > session.climbBudget) return false;
      // 起降段由控制器垂直移动；允许跨越巡航下限的那一包带有水平分量。
      if (
        move.flying &&
        player.flying &&
        Math.max(move.y, player.y) < LAND_FLIGHT.minAltitude &&
        distance > 0.001
      )
        return false;
      session.climbBudget -= climb;
    }
    session.distanceBudget -= distance;
    session.seq = move.seq;
    const { x, y, z, yaw } = move;
    if (
      x !== player.x ||
      y !== player.y ||
      z !== player.z ||
      yaw !== player.yaw ||
      move.flying !== player.flying
    ) {
      session.player = Object.freeze({
        id,
        x,
        y,
        z,
        yaw,
        ...(move.flying ? { flying: true as const } : {}),
      });
      this.dirty = true;
    }
    return true;
  }

  /** 假定快照按序送达；传输层不能静默丢弃增量（慢连接应断开）。 */
  collectSnapshots(): Map<string, MultiplayerSnapshot> {
    const snapshots = new Map<string, MultiplayerSnapshot>();
    const tick = ++this.tick;
    if (!this.dirty) return snapshots;
    this.dirty = false;

    // 网格边长等于退出半径，只需扫描自身格与八个相邻格，再用圆形距离精筛。
    const grid = new Map<string, MultiplayerPlayer[]>();
    for (const { player } of this.sessions.values()) {
      const key = cellKey(cell(player.x), cell(player.z));
      const players = grid.get(key);
      if (players) players.push(player);
      else grid.set(key, [player]);
    }
    for (const session of this.sessions.values()) {
      const { player, seen } = session;
      const nearby = findNearby(player, seen, grid);
      const changed = [...nearby.values()].filter((other) => seen.get(other.id) !== other);
      const removed = [...seen.keys()].filter((id) => !nearby.has(id));
      const newCount = this.land && session.population !== this.sessions.size;
      if (changed.length || removed.length || newCount) {
        snapshots.set(player.id, {
          type: 'snapshot',
          tick,
          changed,
          removed,
          ...(newCount ? { population: this.sessions.size } : {}),
        });
        session.population = this.sessions.size;
      }
      session.seen = nearby;
    }
    return snapshots;
  }
}

function findNearby(
  player: MultiplayerPlayer,
  seen: ReadonlyMap<string, MultiplayerPlayer>,
  grid: ReadonlyMap<string, readonly MultiplayerPlayer[]>,
): Map<string, MultiplayerPlayer> {
  const x = cell(player.x);
  const z = cell(player.z);
  const candidates: { player: MultiplayerPlayer; distanceSquared: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const neighbors = grid.get(cellKey(x + dx, z + dz));
      if (!neighbors) continue;
      for (const other of neighbors) {
        if (other.id === player.id) continue;
        const distanceSquared = horizontalDistanceSquared(player, other);
        const radius = seen.has(other.id) ? MULTIPLAYER.leaveRadius : MULTIPLAYER.enterRadius;
        if (distanceSquared <= radius * radius) candidates.push({ player: other, distanceSquared });
      }
    }
  }

  // 满邻居时优先更近的角色；距离相同用固定 ID 打破平局，避免静止角色来回闪烁。
  candidates.sort(
    (a, b) => a.distanceSquared - b.distanceSquared || Number(a.player.id) - Number(b.player.id),
  );
  return new Map(
    candidates.slice(0, MULTIPLAYER.maxNeighbors).map(({ player: other }) => [other.id, other]),
  );
}

function horizontalDistanceSquared(a: MultiplayerPose, b: MultiplayerPose): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function cell(position: number): number {
  return Math.floor(position / GRID_SIZE);
}

function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}
