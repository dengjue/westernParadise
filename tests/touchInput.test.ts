import { describe, expect, it } from 'vitest';
import { TouchInput } from '@/07-systems';

class PointerLike extends Event {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;

  constructor(
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    pointerId: number,
    pointerType: string,
    clientX: number,
    clientY: number,
  ) {
    super(type, { cancelable: true });
    this.pointerId = pointerId;
    this.pointerType = pointerType;
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

describe('TouchInput', () => {
  it('禁用与失焦清除双指状态，恢复后必须重新按下', () => {
    const moveTarget = new EventTarget(),
      lookTarget = new EventTarget(),
      pointerTarget = new EventTarget();
    const input = new TouchInput({
      moveTarget,
      lookTarget,
      pointerTarget,
      moveRadiusPx: 50,
      lookSensitivityRadPerPixel: 0.01,
    });
    moveTarget.dispatchEvent(new PointerLike('pointerdown', 1, 'touch', 0, 0));
    pointerTarget.dispatchEvent(new PointerLike('pointermove', 1, 'touch', 20, -20));
    input.setEnabled(false);
    expect(input.moveAxis).toEqual({ x: 0, z: 0 });
    input.setEnabled(true);
    pointerTarget.dispatchEvent(new PointerLike('pointermove', 1, 'touch', 40, -40));
    expect(input.moveAxis).toEqual({ x: 0, z: 0 });
    lookTarget.dispatchEvent(new PointerLike('pointerdown', 2, 'touch', 0, 0));
    pointerTarget.dispatchEvent(new PointerLike('pointermove', 2, 'touch', 20, 20));
    pointerTarget.dispatchEvent(new Event('blur'));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    input.dispose();
  });
  it('左侧触控区把拖拽归一化为移动轴，并在抬起后归零', () => {
    const moveTarget = new EventTarget();
    const lookTarget = new EventTarget();
    const pointerTarget = new EventTarget();
    const input = new TouchInput({
      moveTarget,
      lookTarget,
      pointerTarget,
      moveRadiusPx: 50,
      lookSensitivityRadPerPixel: 0.01,
    });

    moveTarget.dispatchEvent(new PointerLike('pointerdown', 1, 'touch', 100, 100));
    pointerTarget.dispatchEvent(new PointerLike('pointermove', 1, 'touch', 125, 75));
    expect(input.moveAxis.x).toBe(0.5);
    expect(input.moveAxis.z).toBe(0.5);

    pointerTarget.dispatchEvent(new PointerLike('pointerup', 1, 'touch', 125, 75));
    expect(input.moveAxis).toEqual({ x: 0, z: 0 });
    input.dispose();
  });

  it('右侧触控区累计视角增量，鼠标指针不会误触发触控轴', () => {
    const moveTarget = new EventTarget();
    const lookTarget = new EventTarget();
    const pointerTarget = new EventTarget();
    const input = new TouchInput({
      moveTarget,
      lookTarget,
      pointerTarget,
      moveRadiusPx: 50,
      lookSensitivityRadPerPixel: 0.01,
    });

    moveTarget.dispatchEvent(new PointerLike('pointerdown', 2, 'mouse', 0, 0));
    expect(input.moveAxis).toEqual({ x: 0, z: 0 });
    lookTarget.dispatchEvent(new PointerLike('pointerdown', 3, 'touch', 20, 20));
    pointerTarget.dispatchEvent(new PointerLike('pointermove', 3, 'touch', 30, 15));
    expect(input.consumeLookDelta()).toEqual({ yaw: 0.1, pitch: -0.05 });
    expect(input.consumeLookDelta()).toEqual({ yaw: 0, pitch: 0 });
    input.dispose();
  });
});
