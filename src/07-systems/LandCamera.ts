import { Raycaster, Vector3 } from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import type { AppEventMap, EventBusLike, MultiplayerPose } from '@/00-types';
import { LAND_AVATAR, LAND_FLIGHT, LAND_JOURNEY as J, LAND_WORLD, PURE_LAND } from '@/01-shared';
import { moveLandPosition, resolveLandNavigation, sampleLandHeight } from '@/02-core';
import type { LandCellCameraPose } from '@/02-core';
import type { InputSource } from './input/InputSource';
import type { LandAvatar } from './LandAvatar';
export { sampleLandHeight } from '@/02-core';

export interface LandCameraOptions {
  readonly camera: PerspectiveCamera;
  readonly input: InputSource;
  readonly events: EventBusLike<AppEventMap>;
  readonly reducedMotion: boolean;
  /** 第三人称角色；不传则保持第一人称步行（默认体验，行为与历史版本一致）。 */
  readonly avatar?: LandAvatar;
  /** 地面联机每次从观览进入游历时使用同一入口。 */
  readonly sharedEntrance?: boolean;
  readonly allowsGroundStep?: Parameters<typeof moveLandPosition>[4];
  /** 遮挡回拉射线检测的对象（通常为场景根）；仅在传入 avatar 时生效。 */
  readonly occluder?: Object3D;
}

export class LandCamera {
  private readonly sharedEntrance: boolean;
  private readonly allowsGroundStep: LandCameraOptions['allowsGroundStep'];
  private readonly camera: PerspectiveCamera;
  private readonly input: InputSource;
  private readonly events: EventBusLike<AppEventMap>;
  private readonly reducedMotion: boolean;
  private readonly avatar: LandAvatar | undefined;
  private readonly occluder: Object3D | undefined;
  private readonly position = new Vector3();
  private readonly cellPose = { x: 0, z: 0, forwardX: 0, forwardZ: 1 };
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
  private flying = false;
  private landing = false;
  private landingHeight = 0;
  private takeoffClimbing = false;
  private readonly flightVelocity = { x: 0, y: 0, z: 0 };
  private navigationElapsedMs = LAND_FLIGHT.navigationUpdateMs;
  private walkCameraSaved = false;
  private readonly savedWalkCamera: { pitch: number; armTarget: number; armDistance: number } = {
    pitch: 0,
    armTarget: LAND_AVATAR.camera.defaultDistance,
    armDistance: LAND_AVATAR.camera.defaultDistance,
  };
  private touring = false;
  private tourElapsed = 0;
  private traveling = false;
  private modal = false;
  private suspended = false;
  private steps = 0;
  private readonly stepEvent = { surface: 'platform' as const };
  private zoom = 1;
  private readonly state = { index: 0, walking: false, flying: false, touring: false };
  // —— 第三人称弹簧臂状态（仅 walking + avatar 时使用）——
  /** 滚轮控制的目标臂长；遮挡回拉只影响实际渲染臂长，不回写目标值。 */
  private armTarget: number = LAND_AVATAR.camera.defaultDistance;
  /** 当前渲染臂长：被遮挡回拉缩短后向目标臂长平滑恢复。 */
  private armDistance: number = LAND_AVATAR.camera.defaultDistance;
  /** 最近一次遮挡射线结论：null 表示无遮挡；数值为允许臂长，在下次射线前保持有效。 */
  private occludedDistance: number | null = null;
  /** 遮挡检测累计时长（秒）：按模拟时间限频，保证回放/测试确定性。 */
  private occlusionTimer = LAND_AVATAR.occlusion.rayIntervalMs / 1000;
  private readonly raycaster = new Raycaster();
  private readonly armAnchor = new Vector3();
  private readonly armDirection = new Vector3();
  /** 起飞/降落的少量净空检查目标复用数组，并排除角色自身几何。 */
  private readonly clearanceTargets: Object3D[] = [];

  constructor(options: LandCameraOptions) {
    this.sharedEntrance = options.sharedEntrance ?? false;
    this.allowsGroundStep = options.allowsGroundStep;
    this.camera = options.camera;
    this.input = options.input;
    this.events = options.events;
    this.reducedMotion = options.reducedMotion;
    this.avatar = options.avatar;
    this.occluder = options.occluder;
    this.removes = [
      this.events.on('land:view', ({ index }) => this.selectView(index)),
      this.events.on('land:walk', () => this.startWalking(true)),
      this.events.on('land:flightToggle', () => this.toggleFlight()),
      this.events.on('land:tour', ({ enabled }) => {
        if (enabled && this.flying) return;
        if (enabled === this.touring) return;
        this.touring = enabled;
        if (this.walking) {
          this.walking = false;
          this.traveling = false;
          this.tourElapsed = J.holdSeconds;
          this.avatar?.setVisible(false);
        }
        this.captureOrbit();
        this.emitState();
      }),
      this.events.on('land:modal', ({ open }) => {
        this.modal = open;
        if (open) this.stopFlightVelocity();
      }),
      this.events.on('land:suspend', ({ suspended }) => {
        this.suspended = suspended;
        if (suspended) this.stopFlightVelocity();
      }),
    ];
    this.selectView(0, true);
  }

  get isWalking(): boolean {
    return this.walking;
  }

  get isFlying(): boolean {
    return this.flying;
  }

  /** 第三人称步行/飞行的角色位置与控制朝向；其余模式不驱动东区 cell 流。 */
  get cellCameraPose(): LandCellCameraPose | null {
    if (!this.avatar || (!this.walking && !this.flying)) return null;
    this.cellPose.x = this.position.x;
    this.cellPose.z = this.position.z;
    this.cellPose.forwardX = Math.sin(this.yaw);
    this.cellPose.forwardZ = Math.cos(this.yaw);
    return this.cellPose;
  }

  selectView(index: number, immediate = false): void {
    const view = PURE_LAND.views[index];
    if (!view) return;
    this.restoreWalkCamera();
    this.index = index;
    this.walking = false;
    this.flying = false;
    this.landing = false;
    this.takeoffClimbing = false;
    this.stopFlightVelocity();
    this.touring = false;
    this.traveling = false;
    this.zoom = 1;
    this.tourElapsed = 0;
    this.avatar?.setVisible(false);
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
    if (this.walking || this.flying || this.modal || this.suspended) return;
    this.walking = true;
    this.touring = false;
    this.traveling = false;
    this.tourElapsed = 0;
    this.position.copy(this.camera.position);
    this.camera.getWorldDirection(this.offset);
    this.yaw = Math.atan2(this.offset.x, this.offset.z);
    this.pitch = Math.max(-J.pitchLimit, Math.min(J.pitchLimit, Math.asin(this.offset.y)));
    if (entrance || this.sharedEntrance) {
      this.position.x = J.entries[0][0];
      this.position.z = J.entries[0][1];
      this.yaw = Math.PI;
      this.pitch = 0;
    }
    const eastPrototype = this.avatar !== undefined;
    if (sampleLandHeight(this.position.x, this.position.z, eastPrototype) === null) {
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
    // 第一人称 position 是眼位（地面 + 眼高）；第三人称 position 是脚底贴地点，
    // 眼高换成弹簧臂注视点高度，两者不共用同一套语义。
    this.position.y =
      sampleLandHeight(this.position.x, this.position.z, eastPrototype)! +
      (this.avatar ? 0 : J.eyeHeight);
    this.steps = 0;
    if (this.avatar) {
      // 重新进入步行：清掉上一次步行的遮挡状态，臂长从目标值起步。
      this.occludedDistance = null;
      this.armDistance = this.armTarget;
      this.avatar.place(this.position, this.yaw);
      this.updateThirdPersonArm(0, true);
    } else {
      this.camera.position.copy(this.position);
    }
    this.emitState();
  }

  /** 握手期间输入尚未放开；同时对齐相机与角色，避免首帧镜头追赶。 */
  placeAtRoomEntrance(pose: MultiplayerPose): void {
    if (!this.sharedEntrance || !this.walking || !this.avatar) return;
    this.position.set(pose.x, pose.y, pose.z);
    this.yaw = pose.yaw;
    this.avatar.place(this.position, this.yaw);
    this.updateThirdPersonArm(0, true);
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, J.maxDeltaSeconds);
    const controls = this.input.consumeLookDelta();
    const zoom = this.input.consumeZoomDelta();
    const axis = this.input.moveAxis;
    const verticalAxis = this.input.verticalAxis;
    if (this.input.consumeFlightToggle()) this.toggleFlight();
    if (this.modal || this.suspended) return;
    if (this.flying) {
      // 清除地面摆步，再由本帧的起飞/滑翔/着陆状态接管空中姿态。
      this.avatar?.updateGroundMotion(dt, 0, false);
      this.updateFlight(dt, controls, zoom, axis, verticalAxis);
      this.updateNavigation(deltaMs);
      return;
    }
    if ((axis.x !== 0 || axis.z !== 0) && !this.walking) this.startWalking();
    if (this.walking) {
      this.yaw -= controls.yaw;
      if (this.avatar) {
        this.pitch = Math.max(
          LAND_AVATAR.camera.minPitch,
          Math.min(LAND_AVATAR.camera.maxPitch, this.pitch - controls.pitch),
        );
      } else {
        this.pitch = Math.max(-J.pitchLimit, Math.min(J.pitchLimit, this.pitch - controls.pitch));
      }
      const forwardX = Math.sin(this.yaw),
        forwardZ = Math.cos(this.yaw);
      const walkSpeed = this.avatar ? LAND_AVATAR.walkSpeed : PURE_LAND.walkSpeed;
      const dx = (forwardX * axis.z - forwardZ * axis.x) * walkSpeed * dt;
      const dz = (forwardZ * axis.z + forwardX * axis.x) * walkSpeed * dt;
      const oldX = this.position.x,
        oldZ = this.position.z;
      moveLandPosition(this.position, dx, dz, this.avatar !== undefined, this.allowsGroundStep);
      const movedX = this.position.x - oldX;
      const movedZ = this.position.z - oldZ;
      const traveledDistance = Math.hypot(movedX, movedZ);
      this.steps += traveledDistance;
      if (this.steps >= J.stepDistance) {
        this.steps %= J.stepDistance;
        this.events.emit('player:step', this.stepEvent);
      }
      const floor = sampleLandHeight(this.position.x, this.position.z, this.avatar !== undefined)!;
      // 第一人称贴眼高，第三人称贴脚底；共用同一地面采样与趋缓系数。
      const restHeight = this.avatar ? 0 : J.eyeHeight;
      this.position.y +=
        (floor + restHeight - this.position.y) * (1 - Math.exp(-dt * J.heightEase));
      if (this.avatar) {
        this.avatar.root.position.copy(this.position);
        this.avatar.updateFlightMotion(dt, 'ground', 0, 0, !this.reducedMotion);
        this.avatar.updateGroundMotion(dt, traveledDistance, !this.reducedMotion);
        if (movedX !== 0 || movedZ !== 0) {
          this.avatar.faceYaw(Math.atan2(movedX, movedZ), dt);
        }
        this.armTarget = Math.max(
          LAND_AVATAR.camera.minDistance,
          Math.min(
            LAND_AVATAR.camera.maxDistance,
            this.armTarget + zoom * LAND_AVATAR.camera.distanceStep,
          ),
        );
        this.updateThirdPersonArm(dt);
        this.updateNavigation(deltaMs);
        return;
      }
      this.camera.position.copy(this.position);
      this.target.set(
        this.position.x + forwardX * Math.cos(this.pitch),
        this.position.y + Math.sin(this.pitch),
        this.position.z + forwardZ * Math.cos(this.pitch),
      );
      this.camera.lookAt(this.target);
      this.look.copy(this.target);
      this.updateNavigation(deltaMs);
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
    this.avatar?.dispose();
  }

  /** 飞行只从第三人称步行态进入；着陆请求若不安全则保持飞行并给出原因。 */
  private toggleFlight(): void {
    if (!this.avatar || this.modal || this.suspended) return;
    if (this.flying) {
      this.beginLanding();
      return;
    }
    if (!this.walking) return;
    if (!this.hasVerticalClearance(1, LAND_FLIGHT.minAltitude - this.position.y)) {
      this.events.emit('land:flightNotice', {
        message: '上方空间受建筑或树木遮挡，请先步行到开阔处再起飞。',
      });
      return;
    }
    this.savedWalkCamera.pitch = this.pitch;
    this.savedWalkCamera.armTarget = this.armTarget;
    this.savedWalkCamera.armDistance = this.armDistance;
    this.walkCameraSaved = true;
    this.pitch = LAND_FLIGHT.defaultPitch;
    this.armTarget = Math.min(LAND_AVATAR.camera.maxDistance, LAND_FLIGHT.followDistance);
    this.armDistance = this.armTarget;
    this.occludedDistance = null;
    this.walking = false;
    this.flying = true;
    this.landing = false;
    this.takeoffClimbing = this.position.y < LAND_FLIGHT.minAltitude;
    this.navigationElapsedMs = LAND_FLIGHT.navigationUpdateMs;
    this.stopFlightVelocity();
    this.emitState();
    this.events.emit('land:flightNotice', { message: '已起飞：WASD 平移，E/Q 升降，V 请求降落。' });
  }

  /** 只允许在当前 x/z 有合法可走地面且下落通道无遮挡时启动降落。 */
  private beginLanding(): void {
    const ground = sampleLandHeight(this.position.x, this.position.z, this.avatar !== undefined);
    if (ground === null) {
      this.events.emit('land:flightNotice', {
        message: '当前位置下方没有安全步行面；请飞到庭院游线或台阶上方再降落。',
      });
      return;
    }
    const clearance = this.position.y - ground;
    if (!this.hasVerticalClearance(-1, clearance)) {
      this.events.emit('land:flightNotice', {
        message: '下方有屋檐、树冠或构件遮挡；请移到开阔地面上方再降落。',
      });
      return;
    }
    this.landing = true;
    this.takeoffClimbing = false;
    this.landingHeight = ground;
    this.flightVelocity.x = 0;
    this.flightVelocity.z = 0;
    this.events.emit('land:flightNotice', { message: '正在平稳降落…' });
  }

  /**
   * 切换模式时才做一次竖直净空射线，不放进每帧热路径。
   * 射线目标列表排除角色根节点，避免把自身误判为障碍；如果任何静态物体挡住
   * 角色到目标高度的垂直通道，就拒绝起飞/降落，避免通过屋顶或树冠。
   */
  private hasVerticalClearance(directionY: 1 | -1, distance: number): boolean {
    if (!this.occluder || distance <= 0) return true;
    this.occluder.updateMatrixWorld(true);
    this.clearanceTargets.length = 0;
    if (this.occluder.children.length === 0) {
      this.clearanceTargets.push(this.occluder);
    } else {
      for (const child of this.occluder.children) {
        if (child !== this.avatar?.root) this.clearanceTargets.push(child);
      }
    }
    this.armAnchor.set(
      this.position.x,
      this.position.y + (directionY > 0 ? LAND_AVATAR.headHeight + 0.2 : 0.15),
      this.position.z,
    );
    this.armDirection.set(0, directionY, 0);
    const rayLength =
      directionY > 0 ? Math.max(0, LAND_FLIGHT.minAltitude - this.armAnchor.y) : distance;
    this.raycaster.set(this.armAnchor, this.armDirection);
    this.raycaster.near = 0.05;
    this.raycaster.far = rayLength;
    const hit = this.raycaster.intersectObjects(this.clearanceTargets, true)[0];
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;
    // 落地目标地面会在射线终点处命中；只拒绝明显早于终点的构件。
    return !hit || hit.distance >= rayLength - 0.45;
  }

  /** 第三人称飞行：水平平移以 yaw 为基准，垂直速度独立控制并受安全高度带约束。 */
  private updateFlight(
    dt: number,
    controls: { yaw: number; pitch: number },
    zoom: number,
    axis: { x: number; z: number },
    verticalAxis: number,
  ): void {
    this.yaw -= controls.yaw;
    this.pitch = Math.max(
      LAND_AVATAR.camera.minPitch,
      Math.min(LAND_AVATAR.camera.maxPitch, this.pitch - controls.pitch),
    );
    this.armTarget = Math.max(
      LAND_AVATAR.camera.minDistance,
      Math.min(
        LAND_AVATAR.camera.maxDistance,
        this.armTarget + zoom * LAND_AVATAR.camera.distanceStep,
      ),
    );

    let axisX = this.landing || this.takeoffClimbing ? 0 : axis.x;
    let axisZ = this.landing || this.takeoffClimbing ? 0 : axis.z;
    const axisLength = Math.hypot(axisX, axisZ);
    if (axisLength > 1) {
      axisX /= axisLength;
      axisZ /= axisLength;
    }
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const targetVelocityX = (forwardX * axisZ - forwardZ * axisX) * LAND_FLIGHT.horizontalSpeed;
    const targetVelocityZ = (forwardZ * axisZ + forwardX * axisX) * LAND_FLIGHT.horizontalSpeed;
    const horizontalRate =
      axisLength > 0 && !this.landing && !this.takeoffClimbing
        ? LAND_FLIGHT.acceleration
        : LAND_FLIGHT.braking;
    const horizontalEase = 1 - Math.exp(-horizontalRate * dt);
    this.flightVelocity.x += (targetVelocityX - this.flightVelocity.x) * horizontalEase;
    this.flightVelocity.z += (targetVelocityZ - this.flightVelocity.z) * horizontalEase;

    let targetVelocityY = verticalAxis * LAND_FLIGHT.verticalSpeed;
    if (this.takeoffClimbing) targetVelocityY = LAND_FLIGHT.verticalSpeed;
    if (this.landing) targetVelocityY = -LAND_FLIGHT.verticalSpeed;
    if (
      (!this.landing && this.position.y <= LAND_FLIGHT.minAltitude && targetVelocityY < 0) ||
      (!this.landing && this.position.y >= LAND_FLIGHT.maxAltitude && targetVelocityY > 0)
    )
      targetVelocityY = 0;
    const verticalRate = targetVelocityY === 0 ? LAND_FLIGHT.braking : LAND_FLIGHT.acceleration;
    this.flightVelocity.y +=
      (targetVelocityY - this.flightVelocity.y) * (1 - Math.exp(-verticalRate * dt));

    const { bounds } = this.avatar ? LAND_WORLD.prototype : PURE_LAND;
    const minX = bounds.minX + LAND_FLIGHT.worldInset;
    const maxX = bounds.maxX - LAND_FLIGHT.worldInset;
    const minZ = bounds.minZ + LAND_FLIGHT.worldInset;
    const maxZ = bounds.maxZ - LAND_FLIGHT.worldInset;
    this.position.x = Math.max(minX, Math.min(maxX, this.position.x + this.flightVelocity.x * dt));
    this.position.z = Math.max(minZ, Math.min(maxZ, this.position.z + this.flightVelocity.z * dt));
    if (this.position.x === minX || this.position.x === maxX) this.flightVelocity.x = 0;
    if (this.position.z === minZ || this.position.z === maxZ) this.flightVelocity.z = 0;

    this.position.y += this.flightVelocity.y * dt;
    if (this.takeoffClimbing) {
      if (this.position.y >= LAND_FLIGHT.minAltitude) {
        this.position.y = LAND_FLIGHT.minAltitude;
        this.takeoffClimbing = false;
        this.flightVelocity.y = 0;
      } else {
        // 起飞必须经过真实的上升路径；不能因常规飞行高度钳制而瞬移到安全带。
        this.position.y = Math.max(0, this.position.y);
      }
    } else if (this.landing && this.position.y <= this.landingHeight) {
      this.position.y = this.landingHeight;
      this.flying = false;
      this.walking = true;
      this.landing = false;
      this.flightVelocity.y = 0;
      this.restoreWalkCamera();
      this.emitState();
      this.events.emit('land:flightNotice', { message: '已安全落地，恢复步行。' });
    } else if (this.landing) {
      this.position.y = Math.max(this.landingHeight, this.position.y);
    } else {
      this.position.y = Math.max(
        LAND_FLIGHT.minAltitude,
        Math.min(LAND_FLIGHT.maxAltitude, this.position.y),
      );
    }

    this.avatar?.root.position.copy(this.position);
    if (!this.landing && (this.flightVelocity.x !== 0 || this.flightVelocity.z !== 0)) {
      this.avatar?.faceYaw(Math.atan2(this.flightVelocity.x, this.flightVelocity.z), dt);
    }
    if (this.avatar) {
      const mode = !this.flying
        ? 'ground'
        : this.landing
          ? 'landing'
          : this.takeoffClimbing
            ? 'takeoff'
            : 'glide';
      this.avatar.updateFlightMotion(
        dt,
        mode,
        Math.hypot(this.flightVelocity.x, this.flightVelocity.z),
        this.flightVelocity.y,
        !this.reducedMotion,
      );
    }
    this.updateThirdPersonArm(dt);
  }

  /** 位置 HUD 最多每 200ms 发布一次，避免每帧事件与 DOM 写入。 */
  private updateNavigation(deltaMs: number): void {
    if (!this.avatar || (!this.walking && !this.flying)) return;
    this.navigationElapsedMs += deltaMs;
    if (this.navigationElapsedMs < LAND_FLIGHT.navigationUpdateMs) return;
    this.navigationElapsedMs %= LAND_FLIGHT.navigationUpdateMs;
    const positionY = this.avatar ? this.position.y : this.position.y - J.eyeHeight;
    const navigation = resolveLandNavigation(this.position.x, this.position.z, this.yaw);
    this.events.emit('land:navigation', {
      x: this.position.x,
      y: positionY,
      z: this.position.z,
      headingDeg: navigation.headingDeg,
      direction: navigation.direction,
      area: navigation.area,
      landmark: navigation.landmark,
      distance: navigation.distance,
      flying: this.flying,
    });
  }

  private stopFlightVelocity(): void {
    this.flightVelocity.x = 0;
    this.flightVelocity.y = 0;
    this.flightVelocity.z = 0;
  }

  /** 飞行采用更远/略俯视的镜头；落地或退出到景点时还原原步行镜头状态。 */
  private restoreWalkCamera(): void {
    if (!this.walkCameraSaved) return;
    this.pitch = this.savedWalkCamera.pitch;
    this.armTarget = this.savedWalkCamera.armTarget;
    this.armDistance = this.savedWalkCamera.armDistance;
    this.walkCameraSaved = false;
    this.occludedDistance = null;
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

  /**
   * 第三人称弹簧臂：相机放在「注视点 + 视线反方向 × 臂长」处。
   *
   * - 注视点 = 脚底 + lookAtHeight，略低于头顶，防止角色顶出画面；
   * - 俯仰为正时相机升高俯视，为负时贴近地面仰视，范围由 LAND_AVATAR 钳制；
   * - 遮挡回拉限频 raycast（默认 120ms）：从注视点向相机方向打射线，命中则把
   *   臂长压到命中距离减余量，再按指数趋缓平滑恢复，避免镜头穿墙或突然弹跳。
   */
  private updateThirdPersonArm(dtSeconds: number, snap = false): void {
    const cfg = LAND_AVATAR.camera;
    const occlusion = LAND_AVATAR.occlusion;
    this.armAnchor.set(this.position.x, this.position.y + cfg.lookAtHeight, this.position.z);
    const cosPitch = Math.cos(this.pitch);
    this.armDirection.set(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );
    // 遮挡检测：按模拟时长限频。命中结论在两次射线之间保持有效——遮挡期间臂长
    // 一直压在允许值上，射线确认无遮挡后才向目标臂长指数恢复，避免限频间隔内
    // 臂长回弹越过目标造成镜头呼吸式振荡。
    this.occlusionTimer += dtSeconds;
    if (this.occluder && this.occlusionTimer >= occlusion.rayIntervalMs / 1000) {
      this.occlusionTimer = 0;
      this.raycaster.set(this.armAnchor, this.armDirection);
      this.raycaster.far = this.armTarget;
      const avatarRoot = this.avatar?.root;
      const hit = this.raycaster.intersectObject(this.occluder, true).find(({ object }) => {
        // 场景根也包含角色；角色自身不能触发避墙缩臂。
        for (let node: Object3D | null = object; node; node = node.parent) {
          if (node === avatarRoot) return false;
        }
        return true;
      });
      this.occludedDistance = hit ? Math.max(0.6, hit.distance - occlusion.margin) : null;
    }
    if (this.occludedDistance !== null) {
      // 遮挡中：立即生效到允许臂长（穿墙不可接受），但不超过滚轮目标。
      this.armDistance = Math.min(this.armTarget, Math.max(0.6, this.occludedDistance));
    } else if (this.armDistance < this.armTarget) {
      this.armDistance = Math.min(
        this.armTarget,
        this.armDistance +
          (this.armTarget - this.armDistance) * (1 - Math.exp(-occlusion.ease * dtSeconds)),
      );
    }
    this.desired.copy(this.armAnchor).addScaledVector(this.armDirection, this.armDistance);
    // 帧率无关阻尼：LAND_AVATAR.camera.ease 是 60fps 下的单帧趋近量，按实际帧长换算。
    const damping =
      snap || this.reducedMotion ? 1 : 1 - Math.pow(1 - cfg.ease, Math.max(dtSeconds, 0) * 60);
    // 角色的平移直接带动镜头；仅对相对角色的镜头偏移施加阻尼。
    // 在世界坐标里追赶角色，会让前进和后退分别拉远、推近主体。
    this.camera.position.sub(this.look).add(this.armAnchor).lerp(this.desired, damping);
    this.look.copy(this.armAnchor);
    this.camera.lookAt(this.look);
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
    this.state.flying = this.flying;
    this.state.touring = this.touring;
    this.events.emit('land:state', this.state);
  }
}
