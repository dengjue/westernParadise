import type { AppEventMap, EventBusLike, GuideEntry } from '@/00-types';
import { COPY } from '@/01-shared';
import type { Vector3 } from 'three';

export interface GuideTriggerTarget {
  readonly position: Vector3;
}

export interface GuideTriggersOptions {
  readonly events: EventBusLike<AppEventMap>;
  readonly player: GuideTriggerTarget;
  readonly entries: readonly GuideEntry[];
}

/**
 * 距离导览触发器。
 *
 * 只计算 x/z 水平投影，故角色走上台基后不会因为 y 高度变化而意外收起说明。每个
 * 固定帧只做一次线性扫描；M1 只有四个触发点，不提前引入空间索引和额外对象分配。
 */
export class GuideTriggers {
  private readonly events: EventBusLike<AppEventMap>;
  private readonly player: GuideTriggerTarget;
  private readonly entries: readonly GuideEntry[];
  private readonly hidePayload = { id: 'taiji' as GuideEntry['id'] };
  private readonly showPayload = { id: 'taiji' as GuideEntry['id'], title: '', body: '' };
  private readonly unsubscribeFrame: () => void;
  private activeId: GuideEntry['id'] | null = null;

  constructor(options: GuideTriggersOptions) {
    this.events = options.events;
    this.player = options.player;
    this.entries = options.entries;
    this.unsubscribeFrame = this.events.on('app:frame', this.onFrame);
  }

  dispose(): void {
    this.unsubscribeFrame();
    this.activeId = null;
  }

  private readonly onFrame = (): void => {
    const playerX = this.player.position.x;
    const playerZ = this.player.position.z;
    let nearest: GuideEntry | undefined;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const entry of this.entries) {
      const distanceX = playerX - entry.position.x;
      const distanceZ = playerZ - entry.position.z;
      const distanceSquared = distanceX * distanceX + distanceZ * distanceZ;
      if (
        distanceSquared <= entry.radius * entry.radius &&
        distanceSquared < nearestDistanceSquared
      ) {
        nearest = entry;
        nearestDistanceSquared = distanceSquared;
      }
    }

    const nextId = nearest?.id ?? null;
    if (nextId === this.activeId) {
      return;
    }

    if (this.activeId !== null) {
      this.hidePayload.id = this.activeId;
      this.events.emit('guide:hide', this.hidePayload);
    }

    this.activeId = nextId;
    if (nearest !== undefined) {
      const copy = COPY.guide[nearest.copyKey];
      this.showPayload.id = nearest.id;
      this.showPayload.title = copy.title;
      this.showPayload.body = copy.body;
      this.events.emit('guide:show', this.showPayload);
    }
  };
}
