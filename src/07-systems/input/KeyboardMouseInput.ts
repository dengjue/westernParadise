import type { InputSource } from './InputSource';

export interface KeyboardMouseInputOptions {
  /** 键盘事件目标由 99-boot 注入，避免系统层隐式读取 window。 */
  readonly keyboardTarget: EventTarget;
  /** 指针、滚轮和右键菜单事件目标由 99-boot 注入。 */
  readonly pointerTarget: EventTarget;
  readonly lookSensitivityRadPerPixel: number;
}

/**
 * M1 键鼠输入。
 *
 * 右键拖拽只记录指针位移，不启用 pointer lock：这样 file:// 单文件、嵌入式预览和
 * 自动化验收都不需要额外的浏览器权限。所有事件目标都从外部传入，类本身不碰全局
 * window/document；每帧只读取已经累计好的小对象，不创建临时数组。
 */
export class KeyboardMouseInput implements InputSource {
  private readonly keyboardTarget: EventTarget;
  private readonly pointerTarget: EventTarget;
  private readonly lookSensitivity: number;
  private readonly axis = { x: 0, z: 0 };
  private readonly lookDelta = { yaw: 0, pitch: 0 };
  private readonly consumedLookDelta = { yaw: 0, pitch: 0 };
  private forwardPressed = false;
  private backwardPressed = false;
  private leftPressed = false;
  private rightPressed = false;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private zoomDelta = 0;

  constructor(options: KeyboardMouseInputOptions) {
    if (options.lookSensitivityRadPerPixel < 0) {
      throw new RangeError('lookSensitivityRadPerPixel 不得为负数');
    }
    this.keyboardTarget = options.keyboardTarget;
    this.pointerTarget = options.pointerTarget;
    this.lookSensitivity = options.lookSensitivityRadPerPixel;

    this.keyboardTarget.addEventListener('keydown', this.onKeyDown);
    this.keyboardTarget.addEventListener('keyup', this.onKeyUp);
    this.keyboardTarget.addEventListener('blur', this.onBlur);
    this.pointerTarget.addEventListener('pointerdown', this.onPointerDown);
    this.pointerTarget.addEventListener('pointermove', this.onPointerMove);
    this.pointerTarget.addEventListener('pointerup', this.onPointerUp);
    this.pointerTarget.addEventListener('pointercancel', this.onPointerUp);
    this.pointerTarget.addEventListener('wheel', this.onWheel, { passive: false });
    this.pointerTarget.addEventListener('contextmenu', this.onContextMenu);
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
    const result = this.zoomDelta;
    this.zoomDelta = 0;
    return result;
  }

  dispose(): void {
    this.keyboardTarget.removeEventListener('keydown', this.onKeyDown);
    this.keyboardTarget.removeEventListener('keyup', this.onKeyUp);
    this.keyboardTarget.removeEventListener('blur', this.onBlur);
    this.pointerTarget.removeEventListener('pointerdown', this.onPointerDown);
    this.pointerTarget.removeEventListener('pointermove', this.onPointerMove);
    this.pointerTarget.removeEventListener('pointerup', this.onPointerUp);
    this.pointerTarget.removeEventListener('pointercancel', this.onPointerUp);
    this.pointerTarget.removeEventListener('wheel', this.onWheel);
    this.pointerTarget.removeEventListener('contextmenu', this.onContextMenu);
    this.dragging = false;
    this.setAllKeys(false);
    this.lookDelta.yaw = 0;
    this.lookDelta.pitch = 0;
    this.consumedLookDelta.yaw = 0;
    this.consumedLookDelta.pitch = 0;
    this.zoomDelta = 0;
  }

  private readonly onKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (!this.setKeyState(keyboard.code, true)) {
      return;
    }
    keyboard.preventDefault();
    this.updateAxis();
  };

  private readonly onKeyUp = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (!this.setKeyState(keyboard.code, false)) {
      return;
    }
    keyboard.preventDefault();
    this.updateAxis();
  };

  private readonly onBlur = (): void => {
    this.setAllKeys(false);
    this.updateAxis();
  };

  private readonly onPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 2) {
      return;
    }
    this.dragging = true;
    this.lastPointerX = pointer.clientX;
    this.lastPointerY = pointer.clientY;
    pointer.preventDefault();
  };

  private readonly onPointerMove = (event: Event): void => {
    if (!this.dragging) {
      return;
    }
    const pointer = event as PointerEvent;
    const deltaX = pointer.clientX - this.lastPointerX;
    const deltaY = pointer.clientY - this.lastPointerY;
    this.lastPointerX = pointer.clientX;
    this.lastPointerY = pointer.clientY;
    this.lookDelta.yaw += deltaX * this.lookSensitivity;
    this.lookDelta.pitch += deltaY * this.lookSensitivity;
    pointer.preventDefault();
  };

  private readonly onPointerUp = (event: Event): void => {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    event.preventDefault();
  };

  private readonly onWheel = (event: Event): void => {
    const wheel = event as WheelEvent;
    const direction = Math.sign(wheel.deltaY);
    if (direction === 0) {
      return;
    }
    // 一帧内快速滚动也只保留方向，避免一次滚轮惯性把相机拉到边界。
    this.zoomDelta = direction;
    wheel.preventDefault();
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private setKeyState(code: string, pressed: boolean): boolean {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.forwardPressed = pressed;
        return true;
      case 'KeyS':
      case 'ArrowDown':
        this.backwardPressed = pressed;
        return true;
      case 'KeyA':
      case 'ArrowLeft':
        this.leftPressed = pressed;
        return true;
      case 'KeyD':
      case 'ArrowRight':
        this.rightPressed = pressed;
        return true;
      default:
        return false;
    }
  }

  private setAllKeys(pressed: boolean): void {
    this.forwardPressed = pressed;
    this.backwardPressed = pressed;
    this.leftPressed = pressed;
    this.rightPressed = pressed;
  }

  private updateAxis(): void {
    let x = 0;
    let z = 0;
    if (this.leftPressed) {
      x -= 1;
    }
    if (this.rightPressed) {
      x += 1;
    }
    if (this.forwardPressed) {
      z += 1;
    }
    if (this.backwardPressed) {
      z -= 1;
    }

    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    this.axis.x = x;
    this.axis.z = z;
  }
}
