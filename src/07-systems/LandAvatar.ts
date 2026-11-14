import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { Object3D, Vector3 } from 'three';
import { LAND_AVATAR } from '@/01-shared';
import { shortestAngle } from './turn';

const FULL_TURN = Math.PI * 2;

/**
 * 第三人称漫游角色（极简程序化人形）。
 *
 * 原型口径（`02-方案/20`）：胶囊身体 + 头部，非交互、非仪式化、不承载任何玩法数值；
 * 根节点原点位于脚底，y 由地面采样决定。相比旧庭院 `Character`，这里只负责
 * 「视觉表现 + 朝向缓动」，移动与碰撞仍由 LandCamera 的步行分支统一处理，
 * 保证第一人称/第三人称使用同一条移动、贴地与步频逻辑。
 */
export class LandAvatar {
  readonly root: Group;

  private yawRad = 0;
  private disposed = false;

  constructor(parent: Object3D) {
    this.root = this.createVisual();
    this.root.name = 'land-avatar';
    this.root.visible = false;
    parent.add(this.root);
  }

  get yaw(): number {
    return this.yawRad;
  }

  /** 放置到脚底位置并立即对齐朝向；用于进入步行瞬间的落位，不做缓动。 */
  place(position: Vector3, yawRad: number): void {
    this.root.position.copy(position);
    this.yawRad = yawRad;
    this.root.rotation.y = yawRad;
    this.root.visible = true;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 从场景移除并释放此角色独占的几何与材质；重复调用安全。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.root.children) {
      if (!(child instanceof Mesh)) continue;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose();
      } else {
        child.material.dispose();
      }
    }
    this.root.removeFromParent();
  }

  /** 朝向缓动：角色面向移动方向；静止时不转动。返回实际转过的角度（供测试断言）。 */
  faceYaw(targetYaw: number, deltaSeconds: number): number {
    const difference = shortestAngle(targetYaw - this.yawRad);
    if (difference === 0) return 0;
    const maxStep = LAND_AVATAR.turnSpeed * Math.max(deltaSeconds, 0);
    if (Math.abs(difference) <= maxStep) {
      this.yawRad += difference;
    } else {
      this.yawRad += Math.sign(difference) * maxStep;
    }
    // 保持角度在 [-π, π) 区间，避免长期累计浮点漂移。
    this.yawRad = ((((this.yawRad + Math.PI) % FULL_TURN) + FULL_TURN) % FULL_TURN) - Math.PI;
    this.root.rotation.y = this.yawRad;
    return difference;
  }

  private createVisual(): Group {
    const group = new Group();
    // 中性石青身体与浅暖色头部形成清楚轮廓；不是僧侣、不是造像，也不带宗教身份暗示。
    const bodyMaterial = new MeshStandardMaterial({
      color: LAND_AVATAR.bodyColor,
      roughness: LAND_AVATAR.roughness,
      metalness: 0,
    });
    const headMaterial = new MeshStandardMaterial({
      color: LAND_AVATAR.headColor,
      roughness: LAND_AVATAR.roughness,
      metalness: 0,
    });
    const body = new Mesh(
      new CapsuleGeometry(LAND_AVATAR.bodyRadius, LAND_AVATAR.bodyHeight, 3, 12),
      bodyMaterial,
    );
    // 胶囊几何以中点为原点：把身体抬高到脚底贴合地面。
    body.name = 'player-body';
    body.position.y = LAND_AVATAR.bodyRadius + LAND_AVATAR.bodyHeight / 2;
    body.castShadow = false;
    body.receiveShadow = false;
    const head = new Mesh(new SphereGeometry(LAND_AVATAR.headRadius, 12, 10), headMaterial);
    head.name = 'player-head';
    head.position.y = LAND_AVATAR.headHeight;
    head.castShadow = false;
    head.receiveShadow = false;
    group.add(body, head);
    return group;
  }
}
