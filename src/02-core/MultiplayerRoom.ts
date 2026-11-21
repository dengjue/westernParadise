import type {
  MultiplayerPlayer,
  MultiplayerPose,
  MultiplayerSnapshot,
  MultiplayerWelcome,
} from '@/00-types';
import { MULTIPLAYER } from '@/01-shared';
import { parseMultiplayerMove } from './multiplayerProtocol';

interface Session {
  player: MultiplayerPlayer;
  seen: Map<string, MultiplayerPlayer>;
  seq: number;
  sampledAt: number;
  messageBudget: number;
  distanceBudget: number;
}

const MAX_DISTANCE = (MULTIPLAYER.maxSpeed * MULTIPLAYER.moveBurstMs) / 1000;
const GRID_SIZE = MULTIPLAYER.leaveRadius;

/**
 * 单房间状态，不持有连接、计时器或浏览器对象。调用方绑定连接与 ID，
 * 注入单调时钟，并按 MULTIPLAYER.tickMs 调用 collectSnapshots。
 */
export class MultiplayerRoom {
  private readonly sessions = new Map<string, Session>();
  private nextId = 1;
  private tick = 0;
  private dirty = false;

  constructor(
    private readonly now: () => number,
    private readonly capacity: number = MULTIPLAYER.capacity,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Invalid multiplayer room capacity');
    }
  }

  join(): MultiplayerWelcome {
    if (this.sessions.size >= this.capacity) {
      return { type: 'rejected', reason: 'room-full' };
    }
    const id = String(this.nextId++);
    this.sessions.set(id, {
      player: Object.freeze({ id, ...MULTIPLAYER.spawn }),
      seen: new Map(),
      seq: -1,
      sampledAt: this.now(),
      messageBudget: MULTIPLAYER.messageBurst,
      distanceBudget: MAX_DISTANCE,
    });
    this.dirty = true;
    return { type: 'welcome', id };
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
    session.distanceBudget = Math.min(
      MAX_DISTANCE,
      session.distanceBudget + dt * MULTIPLAYER.maxSpeed,
    );
    if (session.messageBudget < 1) return false;
    session.messageBudget -= 1;

    const move = parseMultiplayerMove(payload);
    if (!move || move.seq <= session.seq) return false;
    const player = session.player;
    // 台基的 Y 坐标可能一步切换，水平位移查速度，高度单独查合法范围。
    const distance = Math.hypot(player.x - move.x, player.z - move.z);
    if (distance > session.distanceBudget) return false;
    session.distanceBudget -= distance;
    session.seq = move.seq;
    const { x, y, z, yaw } = move;
    if (x !== player.x || y !== player.y || z !== player.z || yaw !== player.yaw) {
      session.player = Object.freeze({ id, x, y, z, yaw });
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
      if (changed.length || removed.length) {
        snapshots.set(player.id, { type: 'snapshot', tick, changed, removed });
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
