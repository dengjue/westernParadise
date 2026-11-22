import type {
  MultiplayerMove,
  MultiplayerPlayer,
  MultiplayerPose,
  MultiplayerSnapshot,
  MultiplayerWelcome,
} from '@/00-types';
import { MULTIPLAYER, LAND_WORLD, LAND_STRUCTURE, LAND_FLIGHT } from '@/01-shared';
import { sampleLandHeight } from './landNavigation';

/** 读取未知消息并只返回协议字段；帧大小与编码由传输层先检查。 */
export function parseMultiplayerMove(value: unknown, land = false): MultiplayerMove | null {
  if (!value || typeof value !== 'object') return null;
  const move = value as Partial<Record<keyof MultiplayerMove, unknown>>;
  const { type, seq } = move;
  if (type !== 'move' || !isCounter(seq, 0)) return null;
  const pose = parsePose(move, land);
  return pose ? { type, seq, ...pose } : null;
}

/** 下行消息先完整验证再应用，避免坏增量污染远端场景。 */
export function parseMultiplayerServerMessage(
  value: unknown,
  land = false,
): MultiplayerWelcome | MultiplayerSnapshot | null {
  if (typeof value !== 'string' || value.length > MULTIPLAYER.maxSnapshotChars) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isObject(payload)) return null;
  if (payload.type === 'welcome' && isPlayerId(payload.id)) {
    return { type: 'welcome', id: payload.id };
  }
  if (payload.type === 'rejected' && payload.reason === 'room-full') {
    return { type: 'rejected', reason: 'room-full' };
  }
  if (
    payload.type !== 'snapshot' ||
    !isCounter(payload.tick, 1) ||
    !Array.isArray(payload.changed) ||
    !Array.isArray(payload.removed) ||
    payload.changed.length > MULTIPLAYER.maxNeighbors ||
    payload.removed.length > MULTIPLAYER.maxNeighbors
  ) {
    return null;
  }
  const ids = new Set<string>();
  const changed: MultiplayerPlayer[] = [];
  const removed: string[] = [];
  for (const item of payload.changed as unknown[]) {
    if (!isObject(item) || !isPlayerId(item.id) || ids.has(item.id)) return null;
    const pose = parsePose(item, land);
    if (!pose) return null;
    ids.add(item.id);
    changed.push({ id: item.id, ...pose });
  }
  for (const id of payload.removed as unknown[]) {
    if (!isPlayerId(id) || ids.has(id)) return null;
    ids.add(id);
    removed.push(id);
  }
  return { type: 'snapshot', tick: payload.tick, changed, removed };
}

function parsePose(
  value: Partial<Record<keyof MultiplayerPose, unknown>>,
  land: boolean,
): MultiplayerPose | null {
  const { x, y, z, yaw } = value;
  const bounds = land ? LAND_WORLD.prototype.bounds : MULTIPLAYER.bounds;
  if (
    !inRange(x, bounds.minX, bounds.maxX) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    !inRange(z, bounds.minZ, bounds.maxZ) ||
    !inRange(yaw, -MULTIPLAYER.maxYaw, MULTIPLAYER.maxYaw)
  ) {
    return null;
  }
  if (value.flying !== undefined) {
    if (!land || value.flying !== true || y < 0 || y > LAND_FLIGHT.maxAltitude) return null;
    if (y < LAND_FLIGHT.minAltitude) {
      const floor = sampleLandHeight(x, z, true);
      if (floor === null || y < floor - LAND_STRUCTURE.navigation.maximumStep) return null;
    }
    return { x, y, z, yaw, flying: true };
  }
  if (land) {
    // 本地脚底随台阶平滑升降，不要求浮点高度逐帧等于地面采样值。
    const floor = sampleLandHeight(x, z, true);
    if (floor === null || Math.abs(y - floor) > LAND_STRUCTURE.navigation.maximumStep * 2)
      return null;
  } else if (!inRange(y, MULTIPLAYER.minY, MULTIPLAYER.maxY)) return null;
  return { x, y, z, yaw };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCounter(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
