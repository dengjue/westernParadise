import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { Object3D, Vector3 } from 'three';
import type { AppEventMap, EventBusLike } from '@/00-types';
import { WORLD } from '@/01-shared';
import type { StaticColliders } from './collision/StaticColliders';
import type { InputSource } from './input/InputSource';

export interface CharacterOptions {
  readonly parent: Object3D;
  readonly colliders: StaticColliders;
  readonly events?: EventBusLike<AppEventMap>;
}

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;
const MOVEMENT_EPSILON = 0.000001;

function shortestAngle(angle: number): number {
  let normalized = (angle + HALF_TURN) % FULL_TURN;
  if (normalized < 0) {
    normalized += FULL_TURN;
  }
  return normalized - HALF_TURN;
}

function moveAngle(current: number, target: number, maxStep: number): number {
  const difference = shortestAngle(target - current);
  if (Math.abs(difference) <= maxStep) {
    return target;
  }
  return current + Math.sign(difference) * maxStep;
}

/**
 * 第三人称漫游角色。
 *
 * 角色根节点原点位于脚底，y 轴只由 StaticColliders 的地面采样决定；水平移动使用
 * 相机相对方向，速度采用指数趋近而不是直接改坐标，因而松手、转向都不会突然跳变。
 */
export class Character {
  readonly root: Group;

  private readonly colliders: StaticColliders;
  private readonly events: EventBusLike<AppEventMap> | undefined;
  private readonly velocity = { x: 0, z: 0 };
  private readonly boundsPayload = { x: 0, z: 0 };
  private yawRad: number;
  private boundaryContact = false;

  constructor(options: CharacterOptions) {
    this.colliders = options.colliders;
    this.events = options.events;
    this.yawRad = (WORLD.spawn.yawDeg * Math.PI) / 180;
    this.root = this.createVisual();
    this.root.name = 'player-character';
    this.root.position.set(
      WORLD.spawn.x,
      this.colliders.sampleGroundHeight(WORLD.spawn.x, WORLD.spawn.z),
      WORLD.spawn.z,
    );
    this.root.rotation.y = this.yawRad;
    options.parent.add(this.root);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get headHeight(): number {
    return WORLD.headHeight;
  }

  get yaw(): number {
    return this.yawRad;
  }

  /** 执行一个固定逻辑步；input 与相机朝向均由 boot 注入。 */
  update(stepMs: number, input: InputSource, cameraYawRad: number): void {
    const deltaSeconds = Math.max(0, stepMs) / 1000;
    if (deltaSeconds === 0) {
      return;
    }

    let axisX = input.moveAxis.x;
    let axisZ = input.moveAxis.z;
    const axisLength = Math.hypot(axisX, axisZ);
    if (axisLength > 1) {
      axisX /= axisLength;
      axisZ /= axisLength;
    }

    // yaw=180° 时前方是 -Z；右向量这样取可以保持屏幕右侧与世界 +X 一致。
    const forwardX = Math.sin(cameraYawRad);
    const forwardZ = Math.cos(cameraYawRad);
    const rightX = -Math.cos(cameraYawRad);
    const rightZ = Math.sin(cameraYawRad);
    const desiredX = rightX * axisX + forwardX * axisZ;
    const desiredZ = rightZ * axisX + forwardZ * axisZ;
    const hasInput = desiredX * desiredX + desiredZ * desiredZ > MOVEMENT_EPSILON;
    const targetVelocityX = hasInput ? desiredX * WORLD.player.walkSpeed : 0;
    const targetVelocityZ = hasInput ? desiredZ * WORLD.player.walkSpeed : 0;
    const responseTime = hasInput ? WORLD.player.accelTime : WORLD.player.decelTime;
    const response = 1 - Math.exp(-deltaSeconds / responseTime);

    this.velocity.x += (targetVelocityX - this.velocity.x) * response;
    this.velocity.z += (targetVelocityZ - this.velocity.z) * response;

    const deltaX = this.velocity.x * deltaSeconds;
    const deltaZ = this.velocity.z * deltaSeconds;
    const startX = this.root.position.x;
    const startZ = this.root.position.z;
    const attemptedX = startX + deltaX;
    const attemptedZ = startZ + deltaZ;
    const outsideBounds =
      attemptedX < WORLD.bounds.minX ||
      attemptedX > WORLD.bounds.maxX ||
      attemptedZ < WORLD.bounds.minZ ||
      attemptedZ > WORLD.bounds.maxZ;

    this.colliders.moveCircle(this.root.position, deltaX, deltaZ);
    this.root.position.y = this.colliders.sampleGroundHeight(
      this.root.position.x,
      this.root.position.z,
    );

    if (
      Math.abs(deltaX) > MOVEMENT_EPSILON &&
      Math.abs(this.root.position.x - startX) < Math.abs(deltaX) - MOVEMENT_EPSILON
    ) {
      this.velocity.x = 0;
    }
    if (
      Math.abs(deltaZ) > MOVEMENT_EPSILON &&
      Math.abs(this.root.position.z - startZ) < Math.abs(deltaZ) - MOVEMENT_EPSILON
    ) {
      this.velocity.z = 0;
    }

    if (outsideBounds && !this.boundaryContact) {
      this.boundsPayload.x = this.root.position.x;
      this.boundsPayload.z = this.root.position.z;
      this.events?.emit('player:boundsExceeded', this.boundsPayload);
    }
    this.boundaryContact = outsideBounds;

    if (hasInput) {
      const targetYaw = Math.atan2(desiredX, desiredZ);
      this.yawRad = moveAngle(this.yawRad, targetYaw, WORLD.player.turnSpeed * deltaSeconds);
      this.root.rotation.y = this.yawRad;
    }
  }

  private createVisual(): Group {
    const visual = WORLD.player.visual;
    const collisionHeight = WORLD.player.capsule.height;
    const bodyRadius = Math.min(WORLD.player.capsule.radius * 0.72, visual.headRadius * 0.9);
    const bodyTotalHeight = collisionHeight - visual.headRadius;
    const bodyMiddleHeight = Math.max(0.1, bodyTotalHeight - bodyRadius * 2);
    const root = new Group();

    const body = new Mesh(
      new CapsuleGeometry(
        bodyRadius,
        bodyMiddleHeight,
        visual.bodyCapSegments,
        visual.bodyRadialSegments,
      ),
      new MeshStandardMaterial({ color: visual.bodyColorHex }),
    );
    body.name = 'player-body';
    body.position.y = bodyTotalHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;

    const head = new Mesh(
      new SphereGeometry(visual.headRadius, visual.headWidthSegments, visual.headHeightSegments),
      new MeshStandardMaterial({ color: visual.headColorHex }),
    );
    head.name = 'player-head';
    head.position.y = bodyTotalHeight;
    head.castShadow = true;
    head.receiveShadow = true;

    root.add(body, head);
    return root;
  }
}
