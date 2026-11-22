import { Group } from 'three';
import type { Object3D, Vector3 } from 'three';
import type { MultiplayerPlayer, MultiplayerSnapshot } from '@/00-types';
import { MULTIPLAYER } from '@/01-shared';
import { shortestAngle } from './turn';

interface RemotePlayer {
  readonly model: Group;
  readonly origin: Vector3;
  startYaw: number;
  yawDelta: number;
  target: MultiplayerPlayer;
  startedAt: number | null;
}

/** 只管远端渲染。克隆节点复用本地角色几何与材质，不在离场时释放共享资源。 */
export class CourtyardRemotePlayers {
  private readonly group = new Group();
  private readonly players = new Map<string, RemotePlayer>();

  constructor(
    parent: Object3D,
    private readonly template: Group,
    private readonly reducedMotion: boolean,
  ) {
    this.group.name = 'courtyard-remote-players';
    parent.add(this.group);
  }

  apply(snapshot: MultiplayerSnapshot, now: number): void {
    for (const id of snapshot.removed) {
      this.players.get(id)?.model.removeFromParent();
      this.players.delete(id);
    }
    for (const target of snapshot.changed) {
      const remote = this.players.get(target.id);
      if (remote) {
        // 从当前可见姿态继续插值，快照到达时间不规则时也不会先跳到上一目标。
        remote.origin.copy(remote.model.position);
        remote.startYaw = remote.model.rotation.y;
        remote.yawDelta = shortestAngle(target.yaw - remote.startYaw);
        remote.target = target;
        remote.startedAt = now;
        if (this.reducedMotion) setPose(remote.model, target);
        continue;
      }
      const model = this.template.clone();
      model.name = `remote-player-${target.id}`;
      model.traverse((node) => {
        node.castShadow = false;
      });
      setPose(model, target);
      this.players.set(target.id, {
        model,
        origin: model.position.clone(),
        startYaw: target.yaw,
        yawDelta: 0,
        target,
        startedAt: null,
      });
      this.group.add(model);
    }
  }

  update(now: number): void {
    if (this.reducedMotion) return;
    for (const remote of this.players.values()) {
      const { target, origin, model, startedAt } = remote;
      if (startedAt === null) continue;
      const t = Math.min(1, Math.max(0, (now - startedAt) / MULTIPLAYER.tickMs));
      if (t === 1) {
        setPose(model, target);
        remote.startedAt = null;
      } else {
        model.position.set(
          origin.x + (target.x - origin.x) * t,
          origin.y + (target.y - origin.y) * t,
          origin.z + (target.z - origin.z) * t,
        );
        model.rotation.y = remote.startYaw + remote.yawDelta * t;
      }
    }
  }

  clear(): void {
    this.players.clear();
    this.group.clear();
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

function setPose(model: Group, { x, y, z, yaw }: MultiplayerPlayer): void {
  model.position.set(x, y, z);
  model.rotation.y = yaw;
}
