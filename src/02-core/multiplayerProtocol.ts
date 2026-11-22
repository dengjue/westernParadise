import type {
  MultiplayerMove,
  MultiplayerPlayer,
  MultiplayerPose,
  MultiplayerSnapshot,
  MultiplayerWelcome,
} from '@/00-types';
import { MULTIPLAYER } from '@/01-shared';

/** 读取未知消息并只返回协议字段；帧大小与编码由传输层先检查。 */
export function parseMultiplayerMove(value: unknown): MultiplayerMove | null {
  if (!value || typeof value !== 'object') return null;
  const move = value as Partial<Record<keyof MultiplayerMove, unknown>>;
  const { type, seq } = move;
  if (type !== 'move' || !isCounter(seq, 0)) return null;
  const pose = parsePose(move);
  return pose ? { type, seq, ...pose } : null;
}

/** 下行消息先完整验证再应用，避免坏增量污染远端场景。 */
export function parseMultiplayerServerMessage(
  value: unknown,
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
    const pose = parsePose(item);
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

function parsePose(value: Partial<Record<keyof MultiplayerPose, unknown>>): MultiplayerPose | null {
  const { x, y, z, yaw } = value;
  if (
    !inRange(x, MULTIPLAYER.bounds.minX, MULTIPLAYER.bounds.maxX) ||
    !inRange(y, MULTIPLAYER.minY, MULTIPLAYER.maxY) ||
    !inRange(z, MULTIPLAYER.bounds.minZ, MULTIPLAYER.bounds.maxZ) ||
    !inRange(yaw, -MULTIPLAYER.maxYaw, MULTIPLAYER.maxYaw)
  ) {
    return null;
  }
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
