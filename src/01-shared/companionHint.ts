import type { MultiplayerPlayer } from '@/00-types';
import { companionColor } from './landAvatar';

const DIRECTIONS = ['前方', '右前', '右侧', '右后', '后方', '左后', '左侧', '左前'] as const;

/** 输入为导航 HUD 的控制朝向（北=0，东=90），不是角色转身动画的瞬时角度。 */
export function companionHint(
  peer: MultiplayerPlayer,
  observer: { x: number; y: number; z: number; headingDeg: number },
): string {
  const dx = peer.x - observer.x;
  const dz = peer.z - observer.z;
  const distance = Math.hypot(dx, dz);
  const relative = ((Math.atan2(dx, -dz) * 180) / Math.PI - observer.headingDeg + 720) % 360;
  const direction = distance < 1 ? '近旁' : DIRECTIONS[Math.round(relative / 45) % 8];
  const dy = peer.y - observer.y;
  const altitude =
    Math.abs(dy) >= 2 ? ` · ${dy > 0 ? '高' : '低'} ${Math.round(Math.abs(dy))} m` : '';
  return `最近：${companionColor(peer.id).name} #${peer.id} · ${direction} ${Math.round(distance)} m${altitude}`;
}
