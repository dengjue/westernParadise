import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { AppEventMap, EventBusLike } from '@/00-types';
import { PURE_LAND } from '@/01-shared';
import type { InputSource } from './input/InputSource';

/** 地面与碰撞共用空间配置，禁止步行进入池水；阶梯按连续坡度采样避免镜头抖动。 */
export function sampleLandHeight(x: number, z: number): number | null {
  let height: number | null = null;
  for (const path of PURE_LAND.paths) {
    const inset = 0.5;
    if (
      x >= path.minX + inset &&
      x <= path.maxX - inset &&
      z >= path.minZ + inset &&
      z <= path.maxZ - inset
    )
      height = path.height;
  }
  if (Math.abs(x) <= 8.6 && z >= -32.5 && z <= -22.5)
    height = 1.2 + Math.min(1, Math.max(0, (-z - 23) / 9)) * 2;
  // 正殿后壁与莲台为实体，柱列半径带上相机所代表的身体余量。
  if (Math.abs(x) < 21 && z < -62) return null;
  if (z < -49 && z > -60 && (Math.abs(x) < 5.5 || Math.abs(Math.abs(x) - 11) < 3.9)) return null;
  const columnZs = [-38.3, -63.7];
  for (let i = 0; i < 6; i++) {
    const columnX = (i / 5 - 0.5) * 40;
    for (const columnZ of columnZs) if (Math.hypot(x - columnX, z - columnZ) < 1.05) return null;
  }
  return height;
}

export class LandCamera {
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private readonly look = new Vector3();
  private readonly desired = new Vector3();
  private readonly offset = new Vector3();
  private readonly removes: (() => void)[];
  private yaw = Math.PI;
  private pitch = 0;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private distance = 1;
  private index = 0;
  private walking = false;
  private touring = false;
  private tourElapsed = 0;
  private zoom = 1;
  private readonly state = { index: 0, walking: false, touring: false };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly input: InputSource,
    private readonly events: EventBusLike<AppEventMap>,
    private readonly reducedMotion: boolean,
  ) {
    this.removes = [
      events.on('land:view', ({ index }) => this.selectView(index)),
      events.on('land:walk', () => this.startWalking()),
      events.on('land:tour', ({ enabled }) => {
        this.touring = enabled;
        this.tourElapsed = 0;
        if (enabled && this.walking) this.selectView(0);
        this.emitState();
      }),
    ];
    this.selectView(0, true);
  }

  get isWalking(): boolean {
    return this.walking;
  }

  selectView(index: number, immediate = false): void {
    const view = PURE_LAND.views[index];
    if (!view) return;
    this.index = index;
    this.walking = false;
    this.zoom = 1;
    this.tourElapsed = 0;
    this.position.fromArray(view.position);
    this.target.fromArray(view.target);
    this.offset.copy(this.position).sub(this.target);
    this.distance = this.offset.length();
    this.orbitYaw = Math.atan2(this.offset.x, this.offset.z);
    this.orbitPitch = Math.asin(this.offset.y / this.distance);
    if (immediate || this.reducedMotion) {
      this.camera.position.copy(this.position);
      this.look.copy(this.target);
      this.camera.lookAt(this.look);
    }
    this.emitState();
  }

  startWalking(): void {
    this.walking = true;
    this.touring = false;
    this.position.set(0, PURE_LAND.eyeHeight + 1.2, 85);
    this.yaw = Math.PI;
    this.pitch = 0.055;
    this.camera.position.copy(this.position);
    this.emitState();
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const controls = this.input.consumeLookDelta();
    const zoom = this.input.consumeZoomDelta();
    const axis = this.input.moveAxis;
    if ((axis.x !== 0 || axis.z !== 0) && !this.walking) this.startWalking();
    if (this.walking) {
      this.yaw -= controls.yaw;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - controls.pitch));
      const forwardX = Math.sin(this.yaw),
        forwardZ = Math.cos(this.yaw);
      const dx = (forwardX * axis.z - forwardZ * axis.x) * PURE_LAND.walkSpeed * dt;
      const dz = (forwardZ * axis.z + forwardX * axis.x) * PURE_LAND.walkSpeed * dt;
      // 分轴滑动让靠栏杆走动自然，地面采样同时阻止跨池和穿入造像。
      if (sampleLandHeight(this.position.x + dx, this.position.z) !== null) this.position.x += dx;
      if (sampleLandHeight(this.position.x, this.position.z + dz) !== null) this.position.z += dz;
      const floor = sampleLandHeight(this.position.x, this.position.z) ?? 1.2;
      this.position.y += (floor + PURE_LAND.eyeHeight - this.position.y) * Math.min(1, dt * 12);
      this.camera.position.copy(this.position);
      this.target.set(
        this.position.x + forwardX * Math.cos(this.pitch),
        this.position.y + Math.sin(this.pitch),
        this.position.z + forwardZ * Math.cos(this.pitch),
      );
      this.camera.lookAt(this.target);
      return;
    }
    if (controls.yaw || controls.pitch || zoom) {
      this.touring = false;
      this.emitState();
    }
    this.orbitYaw -= controls.yaw;
    this.orbitPitch = Math.max(-0.45, Math.min(1.2, this.orbitPitch + controls.pitch));
    this.zoom = Math.max(0.42, Math.min(1.6, this.zoom + zoom * 0.06));
    if (this.touring) {
      this.tourElapsed += dt;
      if (!this.reducedMotion) this.orbitYaw += dt * 0.012;
      if (this.tourElapsed > 16) this.selectView((this.index + 1) % PURE_LAND.views.length);
    }
    const distance = this.distance * this.zoom;
    this.desired.set(
      this.target.x + Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * distance,
      Math.max(2.5, this.target.y + Math.sin(this.orbitPitch) * distance),
      this.target.z + Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * distance,
    );
    const ease = this.reducedMotion ? 1 : 1 - Math.exp(-dt * PURE_LAND.cameraEase);
    this.camera.position.lerp(this.desired, ease);
    this.look.lerp(this.target, ease);
    this.camera.lookAt(this.look);
  }

  dispose(): void {
    for (const remove of this.removes) remove();
  }

  private emitState(): void {
    this.state.index = this.index;
    this.state.walking = this.walking;
    this.state.touring = this.touring;
    this.events.emit('land:state', this.state);
  }
}
