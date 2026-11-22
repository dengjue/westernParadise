import type { MultiplayerPlayer } from '@/00-types';
import { companionColor } from './landAvatar';
import { LAND_JOURNEY } from './landJourney';

const DIRECTIONS = ['前方', '右前', '右侧', '右后', '后方', '左后', '左侧', '左前'] as const;
type Observer = { x: number; y: number; z: number; headingDeg: number };

function horizontalHint(x: number, z: number, observer: Observer) {
  const dx = x - observer.x;
  const dz = z - observer.z;
  const distance = Math.hypot(dx, dz);
  const relative = ((Math.atan2(dx, -dz) * 180) / Math.PI - observer.headingDeg + 720) % 360;
  return { distance, direction: distance < 1 ? '近旁' : DIRECTIONS[Math.round(relative / 45) % 8] };
}

/** 不暴露远方玩家位置；提供双方都能找到的固定会合点。 */
export function rendezvousHint(observer: Observer): string {
  const [x, z] = LAND_JOURNEY.entries[0];
  const { distance, direction } = horizontalHint(x, z, observer);
  if (distance <= 3) return '入口会合点：已到南侧入口附近';
  return `入口会合点：${direction} ${Math.round(distance)} m（水平直线）`;
}

/** 输入为导航 HUD 的控制朝向（北=0，东=90），不是角色转身动画的瞬时角度。 */
export function companionHint(
  peer: MultiplayerPlayer,
  observer: Observer,
  selected = false,
): string {
  const { distance, direction } = horizontalHint(peer.x, peer.z, observer);
  const dy = peer.y - observer.y;
  const altitude =
    Math.abs(dy) >= 2 ? ` · ${dy > 0 ? '高' : '低'} ${Math.round(Math.abs(dy))} m` : '';
  return `${selected ? '选定' : '最近'}：${companionColor(peer.id).name} #${peer.id} · ${direction} ${Math.round(distance)} m${altitude}`;
}
