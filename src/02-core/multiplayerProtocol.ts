import type { MultiplayerMove } from '@/00-types';
import { MULTIPLAYER } from '@/01-shared';

/** 读取未知消息并只返回协议字段；帧大小与编码由传输层先检查。 */
export function parseMultiplayerMove(value: unknown): MultiplayerMove | null {
  if (!value || typeof value !== 'object') return null;
  const move = value as Partial<Record<keyof MultiplayerMove, unknown>>;
  const { type, seq, x, y, z, yaw } = move;
  if (
    type !== 'move' ||
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 0 ||
    !inRange(x, MULTIPLAYER.bounds.minX, MULTIPLAYER.bounds.maxX) ||
    !inRange(y, MULTIPLAYER.minY, MULTIPLAYER.maxY) ||
    !inRange(z, MULTIPLAYER.bounds.minZ, MULTIPLAYER.bounds.maxZ) ||
    !inRange(yaw, -MULTIPLAYER.maxYaw, MULTIPLAYER.maxYaw)
  ) {
    return null;
  }
  return { type, seq, x, y, z, yaw };
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
