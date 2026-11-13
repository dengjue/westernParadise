import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { AppEventMap, EventBusLike } from '@/00-types';
import { LAND_JOURNEY as J, PURE_LAND } from '@/01-shared';
import { moveLandPosition, sampleLandHeight } from '@/02-core';
import type { InputSource } from './input/InputSource';
export { sampleLandHeight } from '@/02-core';

export class LandCamera {
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private readonly look = new Vector3();
  private readonly desired = new Vector3();
  private readonly offset = new Vector3();
  private readonly routeStart = new Vector3();
  private readonly routeLook = new Vector3();
  private readonly routeEnd = new Vector3();
  private readonly controlA = new Vector3();
  private readonly controlB = new Vector3();
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
  private traveling = false;
  private modal = false;
  private suspended = false;
  private steps = 0;
  private readonly stepEvent = { surface: 'platform' as const };
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
      events.on('land:walk', () => this.startWalking(true)),
      events.on('land:tour', ({ enabled }) => {
        if (enabled === this.touring) return;
        this.touring = enabled;
        if (this.walking) {
          this.walking = false;
          this.traveling = false;
          this.tourElapsed = J.holdSeconds;
        }
        this.captureOrbit();
        this.emitState();
      }),
      events.on('land:modal', ({ open }) => {
        this.modal = open;
      }),
      events.on('land:suspend', ({ suspended }) => {
        this.suspended = suspended;
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
    this.touring = false;
    this.traveling = false;
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

  startWalking(entrance = false): void {
    if (this.walking || this.modal || this.suspended) return;
    this.walking = true;
    this.touring = false;
    this.traveling = false;
    this.tourElapsed = 0;
    this.position.copy(this.camera.position);
    this.camera.getWorldDirection(this.offset);
    this.yaw = Math.atan2(this.offset.x, this.offset.z);
    this.pitch = Math.max(-J.pitchLimit, Math.min(J.pitchLimit, Math.asin(this.offset.y)));
    if (entrance) {
      this.position.x = J.entries[0][0];
      this.position.z = J.entries[0][1];
      this.yaw = Math.PI;
      this.pitch = 0;
    }
    if (sampleLandHeight(this.position.x, this.position.z) === null) {
      let nearest = Infinity;
      for (const entry of J.entries) {
        const distance = Math.hypot(
          entry[0] - this.camera.position.x,
          entry[1] - this.camera.position.z,
        );
        if (distance < nearest) {
          nearest = distance;
          this.position.x = entry[0];
          this.position.z = entry[1];
        }
      }
    }
    this.position.y = sampleLandHeight(this.position.x, this.position.z)! + J.eyeHeight;
    this.steps = 0;
    this.camera.position.copy(this.position);
    this.emitState();
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, J.maxDeltaSeconds);
    const controls = this.input.consumeLookDelta();
    const zoom = this.input.consumeZoomDelta();
    const axis = this.input.moveAxis;
    if (this.modal || this.suspended) return;
    if ((axis.x !== 0 || axis.z !== 0) && !this.walking) this.startWalking();
    if (this.walking) {
      this.yaw -= controls.yaw;
      this.pitch = Math.max(-J.pitchLimit, Math.min(J.pitchLimit, this.pitch - controls.pitch));
      const forwardX = Math.sin(this.yaw),
        forwardZ = Math.cos(this.yaw);
      const dx = (forwardX * axis.z - forwardZ * axis.x) * PURE_LAND.walkSpeed * dt;
      const dz = (forwardZ * axis.z + forwardX * axis.x) * PURE_LAND.walkSpeed * dt;
      const oldX = this.position.x,
        oldZ = this.position.z;
      moveLandPosition(this.position, dx, dz);
      this.steps += Math.hypot(this.position.x - oldX, this.position.z - oldZ);
      if (this.steps >= J.stepDistance) {
        this.steps %= J.stepDistance;
        this.events.emit('player:step', this.stepEvent);
      }
      const floor = sampleLandHeight(this.position.x, this.position.z)!;
      this.position.y +=
        (floor + J.eyeHeight - this.position.y) * (1 - Math.exp(-dt * J.heightEase));
      this.camera.position.copy(this.position);
      this.target.set(
        this.position.x + forwardX * Math.cos(this.pitch),
        this.position.y + Math.sin(this.pitch),
        this.position.z + forwardZ * Math.cos(this.pitch),
      );
      this.camera.lookAt(this.target);
      this.look.copy(this.target);
      return;
    }
    if (controls.yaw || controls.pitch || zoom) {
      if (this.touring || this.traveling) this.captureOrbit();
      this.touring = false;
      this.traveling = false;
      this.tourElapsed = 0;
      this.emitState();
    }
    if (this.touring) {
      this.updateTour(dt);
      return;
    }
    this.orbitYaw -= controls.yaw;
    this.orbitPitch = Math.max(
      J.orbitPitch[0],
      Math.min(J.orbitPitch[1], this.orbitPitch + controls.pitch),
    );
    this.zoom = Math.max(J.zoom[0], Math.min(J.zoom[1], this.zoom + zoom * J.zoomStep));
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

  /** 暂停或手动输入时从可见机位接管，不能继续追逐上一个自动目标。 */
  private captureOrbit(): void {
    this.target.copy(this.look);
    this.offset.copy(this.camera.position).sub(this.target);
    this.distance = Math.max(1, this.offset.length());
    this.orbitYaw = Math.atan2(this.offset.x, this.offset.z);
    this.orbitPitch = Math.asin(this.offset.y / this.distance);
    this.zoom = 1;
  }

  private updateTour(dt: number): void {
    this.tourElapsed += dt;
    if (!this.traveling && this.tourElapsed < J.holdSeconds) return;
    const nextIndex = (this.index + 1) % PURE_LAND.views.length;
    const view = PURE_LAND.views[nextIndex]!;
    if (!this.traveling) {
      this.traveling = true;
      this.tourElapsed = 0;
      this.routeStart.copy(this.camera.position);
      this.routeLook.copy(this.look);
      this.routeEnd.fromArray(view.position);
      const curve = J.curves[this.index]!;
      this.controlA.fromArray(curve[0]);
      this.controlB.fromArray(curve[1]);
    }
    const t = this.reducedMotion ? 1 : Math.min(1, this.tourElapsed / J.travelSeconds);
    const ease = t * t * (3 - 2 * t),
      inverse = 1 - ease;
    this.camera.position
      .copy(this.routeStart)
      .multiplyScalar(inverse ** 3)
      .addScaledVector(this.controlA, 3 * inverse * inverse * ease)
      .addScaledVector(this.controlB, 3 * inverse * ease * ease)
      .addScaledVector(this.routeEnd, ease ** 3);
    this.target.fromArray(view.target);
    this.look.copy(this.routeLook).lerp(this.target, ease);
    this.camera.lookAt(this.look);
    if (t === 1) {
      this.index = nextIndex;
      this.traveling = false;
      this.tourElapsed = 0;
      this.captureOrbit();
      this.emitState();
    }
  }

  private emitState(): void {
    this.state.index = this.index;
    this.state.walking = this.walking;
    this.state.touring = this.touring;
    this.events.emit('land:state', this.state);
  }
}
