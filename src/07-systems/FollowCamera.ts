import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { WORLD } from '@/01-shared';
import type { InputSource } from './input/InputSource';

export interface FollowCameraOptions {
  readonly camera: PerspectiveCamera;
  readonly input: InputSource;
}

const FRAME_BASE_MS = 1000 / 60;
const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

function normalizeAngle(angle: number): number {
  let normalized = (angle + HALF_TURN) % FULL_TURN;
  if (normalized < 0) {
    normalized += FULL_TURN;
  }
  return normalized - HALF_TURN;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 第三人称弹簧臂相机。
 *
 * yaw 表示角色前方对应的环绕方位，相机位置取其反方向，因此出生朝向 180° 时相机在
 * 角色南侧、能看到角色背面。M1 不做遮挡回拉，先保证输入、俯仰限制和帧率无关阻尼稳定。
 */
export class FollowCamera {
  private readonly camera: PerspectiveCamera;
  private readonly input: InputSource;
  private readonly lookAtPosition = new Vector3();
  private readonly desiredPosition = new Vector3();
  private yawRad: number;
  private pitchRad: number;
  private distance: number;

  constructor(options: FollowCameraOptions) {
    this.camera = options.camera;
    this.input = options.input;
    this.yawRad = (WORLD.camera.defaultYawDeg * Math.PI) / 180;
    this.pitchRad = (WORLD.camera.defaultPitchDeg * Math.PI) / 180;
    this.distance = WORLD.camera.defaultDist;
  }

  get yaw(): number {
    return this.yawRad;
  }

  get pitch(): number {
    return this.pitchRad;
  }

  get distanceValue(): number {
    return this.distance;
  }

  /** 只消费本帧视角输入；Character 随后可读取 yaw，保证移动和视角使用同一方向。 */
  updateControls(): void {
    const look = this.input.consumeLookDelta();
    this.yawRad = normalizeAngle(this.yawRad + look.yaw);

    const minPitch = (WORLD.camera.pitchMinDeg * Math.PI) / 180;
    const maxPitch = (WORLD.camera.pitchMaxDeg * Math.PI) / 180;
    this.pitchRad = clamp(this.pitchRad - look.pitch, minPitch, maxPitch);
    this.distance = clamp(
      this.distance + this.input.consumeZoomDelta() * WORLD.camera.zoomStep,
      WORLD.camera.minDist,
      WORLD.camera.maxDist,
    );
  }

  /**
   * 更新相机跟随位置。阻尼系数按「60fps 时为 WORLD.camera.lerp」换算，避免帧率影响手感。
   */
  updateFollow(stepMs: number, targetPosition: Vector3): void {
    // 先带走上一帧相对角色的镜头偏移，角色平移不参与转向/缩放的阻尼。
    this.camera.position.sub(this.lookAtPosition);
    this.calculateDesiredPosition(targetPosition);
    this.camera.position.add(this.lookAtPosition);
    const exponent = Math.max(stepMs, 0) / FRAME_BASE_MS;
    const damping = 1 - Math.pow(1 - WORLD.camera.lerp, exponent);
    this.camera.position.lerp(this.desiredPosition, clamp(damping, 0, 1));
    this.camera.lookAt(this.lookAtPosition);
  }

  /** 一次性把相机放到目标位置，避免启动首帧从默认相机位置滑过去。 */
  snapTo(targetPosition: Vector3): void {
    this.calculateDesiredPosition(targetPosition);
    this.camera.position.copy(this.desiredPosition);
    this.camera.lookAt(this.lookAtPosition);
  }

  /** 常规调用顺序：先消费输入，再用目标位置更新跟随。 */
  update(stepMs: number, targetPosition: Vector3): void {
    this.updateControls();
    this.updateFollow(stepMs, targetPosition);
  }

  private calculateDesiredPosition(targetPosition: Vector3): void {
    this.lookAtPosition.set(
      targetPosition.x,
      targetPosition.y + WORLD.headHeight,
      targetPosition.z,
    );
    const horizontalDistance = Math.cos(this.pitchRad) * this.distance;
    this.desiredPosition.set(
      targetPosition.x - Math.sin(this.yawRad) * horizontalDistance,
      this.lookAtPosition.y + Math.sin(this.pitchRad) * this.distance,
      targetPosition.z - Math.cos(this.yawRad) * horizontalDistance,
    );
  }
}
