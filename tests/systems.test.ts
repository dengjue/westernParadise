import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import type { AppEventMap } from '@/00-types';
import { WORLD } from '@/01-shared';
import { EventBus } from '@/02-core';
import { Character, FollowCamera, KeyboardMouseInput, StaticColliders } from '@/07-systems';
import type { InputSource } from '@/07-systems';

class KeyEvent extends Event {
  readonly code: string;

  constructor(type: 'keydown' | 'keyup', code: string) {
    super(type, { cancelable: true });
    this.code = code;
  }
}

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
    buttons = button === 2 && type !== 'pointerup' ? 2 : 0,
  ) {
    super(type, { cancelable: true });
    this.button = button;
    this.buttons = buttons;
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

class WheelEventLike extends Event {
  readonly deltaY: number;

  constructor(deltaY: number) {
    super('wheel', { cancelable: true });
    this.deltaY = deltaY;
  }
}

function idleInput(): InputSource {
  const look = { yaw: 0, pitch: 0 };
  return {
    moveAxis: { x: 0, z: 0 },
    verticalAxis: 0,
    consumeLookDelta() {
      return look;
    },
    consumeZoomDelta() {
      return 0;
    },
    consumeFlightToggle: () => false,
    dispose() {
      // 测试输入没有需要释放的事件监听器。
    },
  };
}

describe('KeyboardMouseInput', () => {
  it('弹窗禁用清掉按键和待消费视角；恢复后的系统重复键不重新启动移动', () => {
    const target = new EventTarget();
    const input = new KeyboardMouseInput({
      keyboardTarget: target,
      pointerTarget: target,
      lookSensitivityRadPerPixel: 0.001,
      flightControlsEnabled: true,
    });
    target.dispatchEvent(new KeyEvent('keydown', 'KeyW'));
    target.dispatchEvent(new PointerEventLike('pointerdown', 2, 10, 10));
    target.dispatchEvent(new PointerEventLike('pointermove', -1, 20, 20, 2));
    target.dispatchEvent(new WheelEventLike(120));
    input.setEnabled(false);
    expect(input.moveAxis).toEqual({ x: 0, z: 0 });
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    expect(input.consumeZoomDelta()).toBe(0);
    input.setEnabled(true);
    target.dispatchEvent(Object.assign(new KeyEvent('keydown', 'KeyW'), { repeat: true }));
    expect(input.moveAxis.z).toBe(0);
    target.dispatchEvent(new KeyEvent('keyup', 'KeyW'));
    target.dispatchEvent(new KeyEvent('keydown', 'KeyW'));
    expect(input.moveAxis.z).toBe(1);
    input.dispose();
  });
  it('把键盘轴归一化，并消费右键视角与滚轮增量', () => {
    const target = new EventTarget();
    const input = new KeyboardMouseInput({
      keyboardTarget: target,
      pointerTarget: target,
      lookSensitivityRadPerPixel: 0.001,
    });

    target.dispatchEvent(new KeyEvent('keydown', 'KeyW'));
    target.dispatchEvent(new KeyEvent('keydown', 'KeyD'));
    expect(input.moveAxis.x).toBeCloseTo(1 / Math.sqrt(2), 6);
    expect(input.moveAxis.z).toBeCloseTo(1 / Math.sqrt(2), 6);

    target.dispatchEvent(new PointerEventLike('pointerdown', 2, 10, 20));
    target.dispatchEvent(new PointerEventLike('pointermove', -1, 30, 5, 2));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0.02, pitch: -0.015 });
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });

    target.dispatchEvent(new WheelEventLike(120));
    expect(input.consumeZoomDelta()).toBe(1);
    expect(input.consumeZoomDelta()).toBe(0);

    target.dispatchEvent(new KeyEvent('keyup', 'KeyW'));
    target.dispatchEvent(new KeyEvent('keyup', 'KeyD'));
    expect(input.moveAxis).toEqual({ x: 0, z: 0 });
    input.dispose();
  });

  it('E/Q 控制垂直轴，V 的模式切换请求只消费一次且失焦清除', () => {
    const target = new EventTarget();
    const input = new KeyboardMouseInput({
      keyboardTarget: target,
      pointerTarget: target,
      lookSensitivityRadPerPixel: 0.001,
      flightControlsEnabled: true,
    });

    target.dispatchEvent(new KeyEvent('keydown', 'KeyE'));
    expect(input.verticalAxis).toBe(1);
    target.dispatchEvent(new KeyEvent('keyup', 'KeyE'));
    target.dispatchEvent(new KeyEvent('keydown', 'KeyQ'));
    expect(input.verticalAxis).toBe(-1);
    target.dispatchEvent(new KeyEvent('keydown', 'KeyV'));
    expect(input.consumeFlightToggle()).toBe(true);
    expect(input.consumeFlightToggle()).toBe(false);
    target.dispatchEvent(new Event('blur'));
    expect(input.verticalAxis).toBe(0);
    expect(input.consumeFlightToggle()).toBe(false);
    input.dispose();
  });

  it('默认第一人称输入不拦截 E/Q/V，保持原有键位语义', () => {
    const target = new EventTarget();
    const input = new KeyboardMouseInput({
      keyboardTarget: target,
      pointerTarget: target,
      lookSensitivityRadPerPixel: 0.001,
    });
    const ascend = new KeyEvent('keydown', 'KeyE');
    const toggle = new KeyEvent('keydown', 'KeyV');
    target.dispatchEvent(ascend);
    target.dispatchEvent(toggle);
    expect(ascend.defaultPrevented).toBe(false);
    expect(toggle.defaultPrevented).toBe(false);
    expect(input.verticalAxis).toBe(0);
    expect(input.consumeFlightToggle()).toBe(false);
    input.dispose();
  });

  it('浏览器吞掉右键按下和松开时仍可拖动，松手后移动不会继续转向', () => {
    const target = new EventTarget();
    const input = new KeyboardMouseInput({
      keyboardTarget: target,
      pointerTarget: target,
      lookSensitivityRadPerPixel: 0.001,
    });

    target.dispatchEvent(new PointerEventLike('pointermove', -1, 100, 100, 0));
    target.dispatchEvent(new PointerEventLike('pointermove', -1, 110, 100, 2));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    target.dispatchEvent(new PointerEventLike('pointermove', -1, 140, 90, 2));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0.03, pitch: -0.01 });
    target.dispatchEvent(new PointerEventLike('pointermove', -1, 180, 120, 0));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });

    // 切走窗口期间没有收到松开，回来后也必须重新建立拖动原点。
    target.dispatchEvent(new PointerEventLike('pointerdown', 2, 180, 120));
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(new PointerEventLike('pointermove', -1, 500, 400, 2));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    input.dispose();
  });
});

describe('StaticColliders', () => {
  it('由活动边界生成四面墙，并允许贴墙保留另一轴位移', () => {
    const colliders = new StaticColliders({
      obstacles: [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }],
    });
    const position = new Vector3(-2, 0, -2);

    colliders.moveCircle(position, 2, 2);
    expect(position.x).toBe(0);
    expect(position.z).toBe(-2);

    const atNorthBoundary = new Vector3(0, 0, WORLD.bounds.maxZ - 0.1);
    colliders.moveCircle(atNorthBoundary, 0, 1);
    expect(atNorthBoundary.z).toBeLessThanOrEqual(WORLD.bounds.maxZ);
  });

  it('按声明顺序采样高差区域，后命中区域覆盖先命中区域', () => {
    const colliders = new StaticColliders({
      ground: {
        baseHeight: 0,
        heightAreas: [
          { minX: -2, maxX: 2, minZ: -2, maxZ: 2, height: 0.5 },
          { minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 0.8 },
        ],
      },
    });

    expect(colliders.sampleGroundHeight(0, 0)).toBe(0.8);
    expect(colliders.sampleGroundHeight(1.5, 0)).toBe(0.5);
    expect(colliders.sampleGroundHeight(3, 0)).toBe(0);
  });
});

describe('Character', () => {
  it('创建程序化人形，并按相机方向移动到高差地面', () => {
    const parent = new Group();
    const colliders = new StaticColliders();
    const events = new EventBus<AppEventMap>();
    const surfaces: string[] = [];
    events.on('player:step', ({ surface }) => surfaces.push(surface));
    const character = new Character({ parent, colliders, events });
    const input: InputSource = {
      moveAxis: { x: 0, z: 1 },
      verticalAxis: 0,
      consumeLookDelta: () => ({ yaw: 0, pitch: 0 }),
      consumeZoomDelta: () => 0,
      consumeFlightToggle: () => false,
      dispose: () => undefined,
    };
    const initialZ = character.position.z;

    for (let step = 0; step < 60; step += 1) {
      character.update(1000 / 60, input, Math.PI);
    }
    expect(character.position.z).toBeLessThan(initialZ);
    expect(surfaces.length).toBeGreaterThan(0);
    expect(character.root.getObjectByName('player-body')).not.toBeNull();
    expect(character.root.getObjectByName('player-head')).not.toBeNull();

    character.position.set(0, 0, -8);
    character.update(1000 / 60, idleInput(), Math.PI);
    expect(character.position.y).toBe(0.8);
  });
});

describe('FollowCamera', () => {
  it('从出生方位放置相机，并钳制俯仰与距离', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const look = { yaw: 0, pitch: 0 };
    let zoom = 0;
    const input: InputSource = {
      moveAxis: { x: 0, z: 0 },
      verticalAxis: 0,
      consumeLookDelta: () => look,
      consumeZoomDelta: () => {
        const value = zoom;
        zoom = 0;
        return value;
      },
      consumeFlightToggle: () => false,
      dispose: () => undefined,
    };
    const followCamera = new FollowCamera({ camera, input });
    const target = new Vector3(0, 0, WORLD.spawn.z);

    followCamera.snapTo(target);
    expect(camera.position.z).toBeGreaterThan(target.z);

    look.yaw = 0.5;
    look.pitch = 100;
    zoom = -10;
    followCamera.updateControls();
    expect(followCamera.pitch).toBe((WORLD.camera.pitchMinDeg * Math.PI) / 180);
    expect(followCamera.distanceValue).toBe(WORLD.camera.minDist);
  });
});
