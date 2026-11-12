import type { InputSource } from './InputSource';

export interface TouchInputOptions {
  /** 左下移动虚拟区；只接收触控/手写笔指针。 */
  readonly moveTarget: EventTarget;
  /** 右下视角虚拟区；只接收触控/手写笔指针。 */
  readonly lookTarget: EventTarget;
  /** 统一接收 pointermove/up/cancel，避免手指离开虚拟区后状态卡住。 */
  readonly pointerTarget: EventTarget;
  readonly moveRadiusPx: number;
  readonly lookSensitivityRadPerPixel: number;
}

/**
 * 触屏输入实现，与键鼠实现并列遵守 InputSource 契约。
 * 左下虚拟区把手指相对起点归一化为移动轴，右下虚拟区把位移转换为相机视角增量；
 * 不读取 window/document，也不创建每帧对象，页面卸载时由 dispose 解除全部监听。
 */
export class TouchInput implements InputSource {
  private readonly moveTarget: EventTarget;
  private readonly lookTarget: EventTarget;
  private readonly pointerTarget: EventTarget;
  private readonly moveRadiusPx: number;
  private readonly lookSensitivity: number;
  private readonly axis = { x: 0, z: 0 };
  private readonly lookDelta = { yaw: 0, pitch: 0 };
  private readonly consumedLookDelta = { yaw: 0, pitch: 0 };
  private movePointerId: number | null = null;
  private lookPointerId: number | null = null;
  private moveOriginX = 0;
  private moveOriginY = 0;
  private lastLookX = 0;
  private lastLookY = 0;

  constructor(options: TouchInputOptions) {
    if (options.moveRadiusPx <= 0 || options.lookSensitivityRadPerPixel < 0) {
      throw new RangeError('触控半径必须为正数，视角灵敏度不得为负数');
    }
    this.moveTarget = options.moveTarget;
    this.lookTarget = options.lookTarget;
    this.pointerTarget = options.pointerTarget;
    this.moveRadiusPx = options.moveRadiusPx;
    this.lookSensitivity = options.lookSensitivityRadPerPixel;

    this.moveTarget.addEventListener('pointerdown', this.onMovePointerDown);
    this.lookTarget.addEventListener('pointerdown', this.onLookPointerDown);
    this.pointerTarget.addEventListener('pointermove', this.onPointerMove);
    this.pointerTarget.addEventListener('pointerup', this.onPointerUp);
    this.pointerTarget.addEventListener('pointercancel', this.onPointerUp);
  }

  get moveAxis(): { x: number; z: number } {
    return this.axis;
  }

  consumeLookDelta(): { yaw: number; pitch: number } {
    this.consumedLookDelta.yaw = this.lookDelta.yaw;
    this.consumedLookDelta.pitch = this.lookDelta.pitch;
    this.lookDelta.yaw = 0;
    this.lookDelta.pitch = 0;
    return this.consumedLookDelta;
  }

  consumeZoomDelta(): number {
    return 0;
  }

  dispose(): void {
    this.moveTarget.removeEventListener('pointerdown', this.onMovePointerDown);
    this.lookTarget.removeEventListener('pointerdown', this.onLookPointerDown);
    this.pointerTarget.removeEventListener('pointermove', this.onPointerMove);
    this.pointerTarget.removeEventListener('pointerup', this.onPointerUp);
    this.pointerTarget.removeEventListener('pointercancel', this.onPointerUp);
    this.resetMove();
    this.movePointerId = null;
    this.lookPointerId = null;
    this.lookDelta.yaw = 0;
    this.lookDelta.pitch = 0;
    this.consumedLookDelta.yaw = 0;
    this.consumedLookDelta.pitch = 0;
  }

  private readonly onMovePointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (!this.isTouchPointer(pointer) || this.movePointerId !== null) {
      return;
    }
    this.movePointerId = pointer.pointerId;
    this.moveOriginX = pointer.clientX;
    this.moveOriginY = pointer.clientY;
    this.updateMove(pointer.clientX, pointer.clientY);
    pointer.preventDefault();
  };

  private readonly onLookPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (!this.isTouchPointer(pointer) || this.lookPointerId !== null) {
      return;
    }
    this.lookPointerId = pointer.pointerId;
    this.lastLookX = pointer.clientX;
    this.lastLookY = pointer.clientY;
    pointer.preventDefault();
  };

  private readonly onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId === this.movePointerId) {
      this.updateMove(pointer.clientX, pointer.clientY);
      pointer.preventDefault();
    }
    if (pointer.pointerId === this.lookPointerId) {
      this.lookDelta.yaw += (pointer.clientX - this.lastLookX) * this.lookSensitivity;
      this.lookDelta.pitch += (pointer.clientY - this.lastLookY) * this.lookSensitivity;
      this.lastLookX = pointer.clientX;
      this.lastLookY = pointer.clientY;
      pointer.preventDefault();
    }
  };

  private readonly onPointerUp = (event: Event): void => {
    const pointer = event as PointerEvent;
    let handled = false;
    if (pointer.pointerId === this.movePointerId) {
      this.movePointerId = null;
      this.resetMove();
      handled = true;
    }
    if (pointer.pointerId === this.lookPointerId) {
      this.lookPointerId = null;
      handled = true;
    }
    if (handled) {
      pointer.preventDefault();
    }
  };

  private updateMove(clientX: number, clientY: number): void {
    let x = (clientX - this.moveOriginX) / this.moveRadiusPx;
    let z = (this.moveOriginY - clientY) / this.moveRadiusPx;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    this.axis.x = x;
    this.axis.z = z;
  }

  private resetMove(): void {
    this.axis.x = 0;
    this.axis.z = 0;
  }

  private isTouchPointer(pointer: PointerEvent): boolean {
    return pointer.pointerType === 'touch' || pointer.pointerType === 'pen';
  }
}
