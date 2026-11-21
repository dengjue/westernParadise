export interface MultiplayerPose {
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
  readonly type: 'snapshot';
  readonly tick: number;
  readonly changed: readonly MultiplayerPlayer[];
  readonly removed: readonly string[];
}

export type MultiplayerWelcome =
  | { readonly type: 'welcome'; readonly id: string }
  | { readonly type: 'rejected'; readonly reason: 'room-full' };
