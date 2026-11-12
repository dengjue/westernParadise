/**
 * 输入抽象：玩法系统只消费归一化后的状态，不知道输入来自键盘、触屏还是自动走查。
 * M1 只实现键鼠；触屏实现可以在不改 Character / FollowCamera 的前提下并列接入。
 */
export interface InputSource {
  /** 归一化移动轴：x 为左右，z 为前后；模长不会超过 1。 */
  readonly moveAxis: { x: number; z: number };
  /** 消费本帧视角增量（弧度），读取后清零。返回对象由实现复用。 */
  consumeLookDelta(): { yaw: number; pitch: number };
  /** 消费滚轮缩放方向，正数拉远、负数拉近，读取后清零。 */
  consumeZoomDelta(): number;
  dispose(): void;
}
