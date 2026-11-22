import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { Object3D, Vector3 } from 'three';
import type { MultiplayerPlayer, MultiplayerSnapshot } from '@/00-types';
import { LAND_PEERS, MULTIPLAYER, companionColor } from '@/01-shared';
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
  private readonly coats = new Map<number, MeshStandardMaterial>();

  get count(): number {
    return this.players.size;
  }

  /** 只扫描当前兴趣范围内的角色，按水平距离选择；同距保留较小编号。 */
  nearestTo(x: number, z: number): MultiplayerPlayer | undefined {
    let nearest: MultiplayerPlayer | undefined;
    let best = Infinity;
    for (const { target } of this.players.values()) {
      const d = (target.x - x) ** 2 + (target.z - z) ** 2;
      if (d < best || (nearest && d === best && Number(target.id) < Number(nearest.id))) {
        best = d;
        nearest = target;
      }
    }
    return nearest;
  }

  /** 对本地分轴小步做扫掠检查，允许从重叠处退出；不改写他人位置。 */
  readonly allowsGroundStep = (
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
  ): boolean => {
    const length2 = dx * dx + dz * dz;
    if (!length2) return true;
    for (const { target, model } of this.players.values()) {
      if (target.flying || Math.abs(target.y - y) >= LAND_PEERS.height) continue;
      // 同时保护网络目标和屏幕当前显示的位置，插值期间也不会主动穿入伙伴。
      if (
        towardsContact(x - target.x, z - target.z, dx, dz, length2) ||
        towardsContact(x - model.position.x, z - model.position.z, dx, dz, length2)
      )
        return false;
    }
    return true;
  };

  constructor(
    parent: Object3D,
    private readonly template: Group,
    private readonly reducedMotion: boolean,
    private readonly roomColors = false,
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
      const body = this.roomColors ? model.getObjectByName('player-body') : null;
      if (body instanceof Mesh && body.material instanceof MeshStandardMaterial) {
        const { hex } = companionColor(target.id);
        let coat = this.coats.get(hex);
        if (!coat) {
          coat = body.material.clone() as MeshStandardMaterial;
          coat.color.setHex(hex);
          this.coats.set(hex, coat);
        }
        body.material = coat;
      }
      model.visible = true;
      model.name = `remote-player-${target.id}`;
      model.traverse((node) => {
        node.castShadow = false;
        // 其他玩家是视觉节点，不能触发镜头避墙或阻止起飞。
        node.raycast = ignoreRaycast;
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
    for (const coat of this.coats.values()) coat.dispose();
    this.coats.clear();
    this.group.removeFromParent();
  }
}

function ignoreRaycast(): void {}

function towardsContact(rx: number, rz: number, dx: number, dz: number, length2: number): boolean {
  const dot = rx * dx + rz * dz;
  if (dot >= 0) return false;
  const t = Math.min(1, -dot / length2);
  return (rx + t * dx) ** 2 + (rz + t * dz) ** 2 < LAND_PEERS.distance ** 2;
}

function setPose(model: Group, { x, y, z, yaw }: MultiplayerPlayer): void {
  model.position.set(x, y, z);
  model.rotation.y = yaw;
}
