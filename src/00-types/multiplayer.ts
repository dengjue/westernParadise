export interface MultiplayerPose {
  /** 只在大世界空中姿态提供；缺省为地面，兼容庭院协议。 */
  readonly flying?: true;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface MultiplayerMove extends MultiplayerPose {
  readonly type: 'move';
  readonly seq: number;
}

export interface MultiplayerPlayer extends MultiplayerPose {
  readonly id: string;
}

export interface MultiplayerSnapshot {
  readonly population?: number;
  readonly type: 'snapshot';
  readonly tick: number;
  readonly changed: readonly MultiplayerPlayer[];
  readonly removed: readonly string[];
}

export type MultiplayerWelcome =
  | {
      readonly type: 'welcome';
      readonly id: string;
      readonly spawn?: MultiplayerPose;
      readonly population?: number;
    }
  | { readonly type: 'rejected'; readonly reason: 'room-full' };
