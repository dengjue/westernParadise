import type { MultiplayerPose, MultiplayerSnapshot } from '@/00-types';
import { MULTIPLAYER, MULTIPLAYER_ENDPOINT } from '@/01-shared';
import { parseMultiplayerServerMessage } from '@/02-core';

export type CourtyardMultiplayerStatus = 'connecting' | 'online' | 'room-full' | 'offline';

/** 局域网模式走页面同源代理，普通开发模式仍走固定回环端点。 */
export function courtyardMultiplayerUrl(
  search: string,
  origin: string,
  lanOrigin?: string,
): string | null {
  if (new URLSearchParams(search).get('multiplayer') !== '1') return null;
  if (lanOrigin && origin === lanOrigin && origin.startsWith('http://')) {
    return `ws://${new URL(origin).host}${MULTIPLAYER_ENDPOINT.path}`;
  }
  if (!MULTIPLAYER_ENDPOINT.allowedOrigins.some((value) => value === origin)) return null;
  const { host, port, path } = MULTIPLAYER_ENDPOINT;
  return `ws://${host}:${port}${path}`;
}

export class CourtyardMultiplayerClient {
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private id: string | undefined;
  private lastTick = 0;
  private seq = 0;
  private lastSentAt = -Infinity;
  private lastPose: MultiplayerPose = MULTIPLAYER.spawn;

  constructor(
    url: string,
    private readonly onStatus: (status: CourtyardMultiplayerStatus) => void,
    private readonly onSnapshot: (snapshot: MultiplayerSnapshot) => void,
    private readonly land = false,
    private readonly onSpawn?: (pose: MultiplayerPose) => void,
  ) {
    onStatus('connecting');
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener('message', this.receive);
      socket.addEventListener('error', this.disconnect);
      socket.addEventListener('close', this.disconnect);
      // 等服务端分配 ID，不以底层 WebSocket 完成握手作为入场成功。
      this.timer = setTimeout(this.disconnect, MULTIPLAYER.connectTimeoutMs);
    } catch {
      this.disconnect();
    }
  }

  /** 渲染循环最多每个同步节拍取样一次；不积攒后台标签页的待发送动作。 */
  update(
    now: number,
    position: Readonly<Pick<MultiplayerPose, 'x' | 'y' | 'z'>>,
    yaw: number,
    flying = false,
  ): void {
    const socket = this.socket;
    if (
      !this.id ||
      socket?.readyState !== WebSocket.OPEN ||
      now - this.lastSentAt < MULTIPLAYER.tickMs
    ) {
      return;
    }
    const { x, y, z } = position;
    // 本地转向跨过 ±π 时可能暂时落在区间之外；协议只接受规范化角度。
    if (Math.abs(yaw) > MULTIPLAYER.maxYaw) yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const previous = this.lastPose;
    if (
      previous.x === x &&
      previous.y === y &&
      previous.z === z &&
      previous.yaw === yaw &&
      Boolean(previous.flying) === flying
    )
      return;
    if (socket.bufferedAmount > MULTIPLAYER.maxClientQueueBytes) {
      this.disconnect();
      return;
    }
    const pose = { x, y, z, yaw, ...(flying ? { flying: true as const } : {}) };
    try {
      socket.send(JSON.stringify({ type: 'move', seq: this.seq++, ...pose }));
      this.lastSentAt = now;
      this.lastPose = pose;
    } catch {
      this.disconnect();
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeEventListener('message', this.receive);
    socket.removeEventListener('error', this.disconnect);
    socket.removeEventListener('close', this.disconnect);
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  }

  private readonly receive = (event: MessageEvent<unknown>): void => {
    const message = parseMultiplayerServerMessage(event.data, this.land);
    if (!message) {
      this.disconnect();
    } else if (message.type === 'welcome' && !this.id) {
      this.id = message.id;
      if (message.spawn) {
        this.lastPose = message.spawn;
        this.onSpawn?.(message.spawn);
      }
      clearTimeout(this.timer);
      this.onStatus('online');
    } else if (message.type === 'rejected' && !this.id) {
      this.dispose();
      this.onStatus('room-full');
    } else if (message.type === 'snapshot' && this.id) {
      if (message.tick <= this.lastTick) return;
      // 自身 ID 不应出现在服务端增量中，出现即回退避免画出重影。
      if (message.changed.some(({ id }) => id === this.id) || message.removed.includes(this.id)) {
        this.disconnect();
        return;
      }
      this.lastTick = message.tick;
      this.onSnapshot(message);
    } else {
      this.disconnect();
    }
  };

  private readonly disconnect = (): void => {
    this.dispose();
    this.onStatus('offline');
  };
}
