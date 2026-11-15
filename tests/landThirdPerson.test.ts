import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, PerspectiveCamera } from 'three';
import type { AppEventMap } from '@/00-types';
import { LAND_AVATAR, LAND_FLIGHT, LAND_WORLD } from '@/01-shared';
import { parseParams } from '@/03-platform';
import { EventBus } from '@/02-core';
import { KeyboardMouseInput, LandAvatar, LandCamera } from '@/07-systems';

class PointerEventLike extends Event {
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;

  constructor(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    button: number,
    clientX: number,
    clientY: number,
    buttons = type === 'pointerup' ? 0 : button === 0 ? 1 : 2,
  ) {
    super(type, { cancelable: true });
    this.button = button;
    this.buttons = buttons;
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

describe('KeyboardMouseInput 左键环视（规范 W1）', () => {
  function makeInput(thresholdPx?: number) {
    const target = new EventTarget();
    const input = new KeyboardMouseInput({
      keyboardTarget: target,
      pointerTarget: target,
      lookSensitivityRadPerPixel: 0.001,
      ...(thresholdPx === undefined ? {} : { clickThresholdPx: thresholdPx }),
    });
    return { target, input };
  }

  it('轻点（位移小于阈值）不产生视角增量', () => {
    const { target, input } = makeInput();
    target.dispatchEvent(new PointerEventLike('pointerdown', 0, 100, 100));
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 101, 101, 1));
    target.dispatchEvent(new PointerEventLike('pointerup', 0, 103, 103, 0));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    input.dispose();
  });

  it('越过阈值后从越界点开始累计视角，阈值内的微小抖动被丢弃', () => {
    const { target, input } = makeInput();
    target.dispatchEvent(new PointerEventLike('pointerdown', 0, 100, 100));
    // 2px 抖动：未 armed，无视角。
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 102, 102, 1));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    // 累计位移 20px > 4px 阈值：armed 并重取原点，本步不产生视角。
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 120, 120, 1));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    // 之后的位移正常累计。
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 130, 110, 1));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0.01, pitch: -0.01 });
    input.dispose();
  });

  it('拖拽中途失焦重置状态，恢复后必须重新按下才能继续转向', () => {
    const { target, input } = makeInput();
    target.dispatchEvent(new PointerEventLike('pointerdown', 0, 100, 100));
    // 越过阈值（armed，本步不累计），随后一步开始累计视角。
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 160, 140, 1));
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 170, 140, 1));
    expect(input.consumeLookDelta().yaw).toBeGreaterThan(0);
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(new PointerEventLike('pointermove', 0, 300, 300, 1));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    input.dispose();
  });

  it('右键兼容路径保持旧语义：按下即 armed，无需阈值', () => {
    const { target, input } = makeInput();
    target.dispatchEvent(new PointerEventLike('pointerdown', 2, 10, 20));
    target.dispatchEvent(new PointerEventLike('pointermove', 2, 30, 5, 2));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0.02, pitch: -0.015 });
    input.dispose();
  });
});

describe('parseParams cam 参数', () => {
  it('默认 first；third / 大写归一；非法值回退 first 并告警', () => {
    expect(parseParams('').cam).toBe('first');
    expect(parseParams('?cam=third').cam).toBe('third');
    expect(parseParams('?cam=THIRD').cam).toBe('third');
    expect(parseParams('?cam=first').cam).toBe('first');
    const warnings: string[] = [];
    const result = parseParams('?cam=side', (message) => warnings.push(message));
    expect(result.cam).toBe('first');
    expect(warnings).toHaveLength(1);
  });
});

describe('LandAvatar 程序化角色（规范 W2）', () => {
  it('默认隐藏；place 落位可见；faceYaw 按角速度钳制缓动', () => {
    const parent = new Group();
    const avatar = new LandAvatar(parent);
    expect(avatar.root.visible).toBe(false);
    expect(parent.children).toContain(avatar.root);

    avatar.place({ x: 1, y: 0.5, z: 2 } as never, Math.PI);
    expect(avatar.root.visible).toBe(true);
    expect(avatar.root.position.x).toBe(1);
    expect(avatar.yaw).toBe(Math.PI);

    // turnSpeed = 9 rad/s，0.1s 最多转 0.9 rad，不足 π/2；yaw 归一在 [-π, π)。
    const turned = avatar.faceYaw(Math.PI / 2 + Math.PI, 0.1);
    expect(turned).toBeCloseTo(Math.PI / 2, 6);
    expect(avatar.yaw).toBeCloseTo(Math.PI + 0.9 - Math.PI * 2, 6);
    // 到达目标后不再转动（目标 3π/2 归一为 -π/2）。
    avatar.faceYaw(Math.PI / 2 + Math.PI, 0.1);
    expect(avatar.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe('LandCamera 第三人称步行（规范 W3/W4/W5）', () => {
  function fixture(occluder?: Mesh) {
    const parent = new Group();
    const events = new EventBus<AppEventMap>();
    const camera = new PerspectiveCamera();
    const look = { yaw: 0, pitch: 0 };
    let zoom = 0;
    let vertical = 0;
    const input = {
      moveAxis: { x: 0, z: 0 },
      get verticalAxis() {
        return vertical;
      },
      consumeLookDelta: () => look,
      consumeZoomDelta: () => {
        const value = zoom;
        zoom = 0;
        return value;
      },
      consumeFlightToggle: () => false,
      dispose() {},
    };
    const avatar = new LandAvatar(parent);
    const control = new LandCamera({
      camera,
      input,
      events,
      reducedMotion: false,
      avatar,
      occluder: occluder ?? parent,
    });
    const advance = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) control.update(1000 / 60);
    };
    return {
      parent,
      events,
      camera,
      look,
      input,
      avatar,
      control,
      advance,
      setZoom: (v: number) => (zoom = v),
      setVertical: (v: number) => (vertical = v),
    };
  }

  it('进入步行：角色落在入口脚底，相机在角色背后默认臂长处', () => {
    const f = fixture();
    f.control.startWalking(true);
    expect(f.avatar.root.visible).toBe(true);
    const feet = f.avatar.root.position.clone();
    // pitch 默认为 0：相机与注视点同高，水平距离等于臂长。
    const flatAnchor = f.camera.position.clone().setY(feet.y + LAND_AVATAR.camera.lookAtHeight);
    expect(f.camera.position.distanceTo(flatAnchor)).toBeLessThan(1e-3);
    expect(f.camera.position.z - feet.z).toBeCloseTo(LAND_AVATAR.camera.defaultDistance, 3);
    f.control.dispose();
  });

  it('仅第三人称漫游提供区域流姿态，默认第一人称不驱动 cell 调度', () => {
    const f = fixture();
    const firstPerson = new LandCamera({
      camera: new PerspectiveCamera(),
      input: f.input,
      events: f.events,
      reducedMotion: false,
    });
    expect(firstPerson.cellCameraPose).toBeNull();
    firstPerson.dispose();

    expect(f.control.cellCameraPose).toBeNull();
    f.control.startWalking(true);
    const pose = f.control.cellCameraPose!;
    expect(pose).toMatchObject({ x: 0, z: 85, forwardZ: -1 });
    expect(pose.forwardX).toBeCloseTo(0);
    f.control.dispose();
  });

  it('释放第三人称角色时移除场景节点并只释放独占资源一次', () => {
    const parent = new Group();
    const avatar = new LandAvatar(parent);
    const meshes = avatar.root.children.filter((child): child is Mesh => child instanceof Mesh);
    const geometries = meshes.map(({ geometry }) => geometry);
    const materials = meshes.flatMap(({ material }) =>
      Array.isArray(material) ? material : [material],
    );
    const geometryDisposals = geometries.map(() => 0);
    const materialDisposals = materials.map(() => 0);
    geometries.forEach((geometry, index) =>
      geometry.addEventListener(
        'dispose',
        () => (geometryDisposals[index] = geometryDisposals[index]! + 1),
      ),
    );
    materials.forEach((material, index) =>
      material.addEventListener(
        'dispose',
        () => (materialDisposals[index] = materialDisposals[index]! + 1),
      ),
    );

    avatar.dispose();
    avatar.dispose();

    expect(parent.children).not.toContain(avatar.root);
    expect(geometryDisposals).toEqual([1, 1]);
    expect(materialDisposals).toEqual([1, 1]);
  });

  it('步行推进角色并保持背后跟随，角色面向移动方向', () => {
    const f = fixture();
    f.control.startWalking(true);
    const startZ = f.avatar.root.position.z;
    f.input.moveAxis.z = 1;
    f.advance(1);
    f.input.moveAxis.z = 0;
    f.advance(0.5);
    expect(f.avatar.root.position.z).toBeLessThan(startZ);
    // yaw = π 时前进方向为 -z，角色面向 -z 即 yaw ≈ π。
    expect(Math.abs(Math.abs(f.avatar.yaw) - Math.PI)).toBeLessThan(0.05);
    expect(f.camera.position.z).toBeGreaterThan(f.avatar.root.position.z);
    f.control.dispose();
  });

  it('滚轮调距被钳制在配置范围内，俯仰被钳制在 [-0.5, 1.15]', () => {
    const f = fixture();
    f.control.startWalking(true);
    f.setZoom(1);
    f.advance(2);
    const anchor = f.avatar.root.position.clone();
    anchor.y += LAND_AVATAR.camera.lookAtHeight;
    const distance = f.camera.position.distanceTo(anchor);
    expect(distance).toBeGreaterThan(LAND_AVATAR.camera.defaultDistance);
    expect(distance).toBeLessThanOrEqual(LAND_AVATAR.camera.maxDistance + 1e-3);

    f.look.pitch = 100;
    f.advance(1);
    f.look.pitch = 0;
    f.advance(1);
    expect(f.camera.position.y - anchor.y).toBeLessThanOrEqual(
      Math.sin(LAND_AVATAR.camera.maxPitch) * LAND_AVATAR.camera.maxDistance + 1e-3,
    );
    f.control.dispose();
  });

  it('遮挡回拉：角色与相机之间的障碍把臂长压到命中距离以内', () => {
    // 在相机方向（+z，yaw=π）距注视点 2.5m 处放一块板。
    const board = new Mesh(new BoxGeometry(2, 2, 0.5));
    const f = fixture(board);
    f.control.startWalking(true);
    const anchor = f.avatar.root.position.clone();
    anchor.y += LAND_AVATAR.camera.lookAtHeight;
    board.position.set(anchor.x, anchor.y, anchor.z + 2.5);
    f.parent.add(board);
    board.updateMatrixWorld(true);
    // 遮挡按模拟时长限频：推进 1s 保证触发射线且位置阻尼充分收敛。
    f.advance(1);
    const distance = f.camera.position.distanceTo(anchor);
    expect(distance).toBeLessThan(2.2);
    expect(distance).toBeGreaterThanOrEqual(0.6);
    f.control.dispose();
  });

  it('退出步行（选景 / 自动游览接管）隐藏角色，相机回到轨道机位', () => {
    const f = fixture();
    f.control.selectView(1, true);
    f.control.startWalking(true);
    expect(f.avatar.root.visible).toBe(true);
    f.control.selectView(2, true);
    expect(f.avatar.root.visible).toBe(false);

    f.control.startWalking(true);
    f.events.emit('land:tour', { enabled: true });
    expect(f.avatar.root.visible).toBe(false);
    f.control.dispose();
    expect(f.events.size).toBe(0);
  });

  it('竖直通道被静态屋顶遮挡时拒绝起飞；开阔处可升至高度带', () => {
    const blocked = fixture();
    blocked.control.startWalking(true);
    const roof = new Mesh(new BoxGeometry(5, 2, 5));
    roof.position.set(0, 20, 85);
    blocked.parent.add(roof);
    roof.updateMatrixWorld(true);
    blocked.events.emit('land:flightToggle', {});
    expect(blocked.control.isFlying).toBe(false);
    expect(blocked.control.isWalking).toBe(true);
    blocked.control.dispose();

    const open = fixture();
    open.control.startWalking(true);
    open.events.emit('land:flightToggle', {});
    expect(open.control.isFlying).toBe(true);
    expect(open.control.isWalking).toBe(false);
    open.advance(1);
    expect(open.avatar.root.position.y).toBeLessThan(LAND_FLIGHT.minAltitude);
    open.advance(11);
    expect(open.avatar.root.position.y).toBeCloseTo(LAND_FLIGHT.minAltitude, 2);
    open.control.dispose();
  });

  it('飞行保持高度/水平边界，垂直控制在最大高度钳制', () => {
    const f = fixture();
    f.control.startWalking(true);
    f.events.emit('land:flightToggle', {});
    f.advance(12);
    f.setVertical(1);
    f.advance(20);
    expect(f.avatar.root.position.y).toBe(LAND_FLIGHT.maxAltitude);

    const maxX = LAND_WORLD.prototype.bounds.maxX - LAND_FLIGHT.worldInset;
    f.avatar.root.position.x = maxX - 0.1;
    f.input.moveAxis.x = 1;
    f.advance(60);
    expect(f.avatar.root.position.x).toBe(maxX);
    f.control.dispose();
  });

  it('第三人称可沿南侧门户步行进入东区并停在灰盒边界', () => {
    const f = fixture();
    f.control.startWalking(true);
    f.input.moveAxis.x = 1;
    f.advance(60);
    f.input.moveAxis.x = 0;
    expect(f.avatar.root.position.x).toBeGreaterThan(350);
    expect(f.avatar.root.position.x).toBeLessThan(LAND_WORLD.prototype.bounds.maxX);
    expect(f.avatar.root.position.z).toBeCloseTo(85, 2);
    f.control.dispose();
  });

  it('飞行可在有效步行面安全降落并恢复步行状态', () => {
    const f = fixture();
    const notices: string[] = [];
    f.events.on('land:flightNotice', ({ message }) => notices.push(message));
    f.control.startWalking(true);
    f.events.emit('land:flightToggle', {});
    expect(notices).toEqual(['已起飞：WASD 平移，E/Q 升降，V 请求降落。']);
    f.advance(12);
    expect(f.avatar.root.position.y).toBeCloseTo(LAND_FLIGHT.minAltitude, 2);
    const flightAnchor = f.avatar.root.position.clone();
    flightAnchor.y += LAND_AVATAR.camera.lookAtHeight;
    expect(f.camera.position.distanceTo(flightAnchor)).toBeCloseTo(LAND_FLIGHT.followDistance, 1);

    const canopy = new Mesh(new BoxGeometry(4, 2, 4));
    canopy.position.set(0, 20, 85);
    f.parent.add(canopy);
    f.events.emit('land:flightToggle', {});
    expect(f.control.isFlying).toBe(true);
    expect(notices.at(-1)).toContain('下方有屋檐');
    f.parent.remove(canopy);

    f.events.emit('land:flightToggle', {});
    expect(notices).toEqual([
      '已起飞：WASD 平移，E/Q 升降，V 请求降落。',
      '下方有屋檐、树冠或构件遮挡；请移到开阔地面上方再降落。',
      '正在平稳降落…',
    ]);
    expect(f.control.isFlying).toBe(true);
    f.advance(12);
    expect(f.control.isFlying).toBe(false);
    expect(f.control.isWalking).toBe(true);
    expect(f.avatar.root.position.y).toBeLessThan(LAND_FLIGHT.minAltitude);
    const walkAnchor = f.avatar.root.position.clone();
    walkAnchor.y += LAND_AVATAR.camera.lookAtHeight;
    expect(f.camera.position.distanceTo(walkAnchor)).toBeCloseTo(
      LAND_AVATAR.camera.defaultDistance,
      1,
    );
    f.control.dispose();
  });

  it('下方没有可走地面时拒绝降落并保持飞行，不传送角色', () => {
    const f = fixture();
    const notices: string[] = [];
    f.events.on('land:flightNotice', ({ message }) => notices.push(message));
    f.control.startWalking(true);
    f.events.emit('land:flightToggle', {});
    f.advance(12);
    // 先沿世界 +x 飞到东区，再朝北飞至莲池上方、避开桥面。
    f.input.moveAxis.x = 1;
    f.advance(30);
    f.input.moveAxis.x = 0;
    f.input.moveAxis.z = 1;
    f.advance(7.5);
    f.input.moveAxis.z = 0;
    const before = f.avatar.root.position.clone();
    f.events.emit('land:flightToggle', {});
    expect(f.control.isFlying).toBe(true);
    expect(notices.at(-1)).toContain('没有安全步行面');
    expect(f.avatar.root.position.toArray()).toEqual(before.toArray());
    f.control.dispose();
  });

  it('步行和飞行导航事件按 200ms 节流，约每秒最多发布五次', () => {
    const f = fixture();
    let navigationUpdates = 0;
    f.events.on('land:navigation', () => navigationUpdates++);
    f.control.startWalking(true);
    f.advance(1);
    expect(navigationUpdates).toBe(5);
    f.events.emit('land:flightToggle', {});
    navigationUpdates = 0;
    f.advance(1);
    expect(navigationUpdates).toBe(5);
    f.control.dispose();
  });
});
