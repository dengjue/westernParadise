import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { AppEventMap, GuideEntry } from '@/00-types';
import { EventBus } from '@/02-core';
import { COPY } from '@/01-shared';
import { GuideTriggers } from '@/07-systems';

function frame(events: EventBus<AppEventMap>): void {
  events.emit('app:frame', { deltaMs: 16, elapsedMs: 16 });
}

describe('GuideTriggers', () => {
  it('按水平距离进入/离开触发区，并在重叠时选择最近点', () => {
    const events = new EventBus<AppEventMap>();
    const position = new Vector3(0, 99, 0);
    const entries: readonly GuideEntry[] = [
      {
        id: 'puzhuang',
        copyKey: 'puzhuang',
        position: { x: 4, y: 12, z: 0 },
        radius: 5,
      },
      {
        id: 'taiji',
        copyKey: 'taiji',
        position: { x: 2, y: 0, z: 0 },
        radius: 5,
      },
    ];
    const shown: Array<{ id: string; title: string; body: string }> = [];
    const hidden: string[] = [];
    const offShow = events.on('guide:show', (payload) => {
      shown.push({ id: payload.id, title: payload.title, body: payload.body });
    });
    const offHide = events.on('guide:hide', ({ id }) => {
      hidden.push(id);
    });
    const triggers = new GuideTriggers({ events, player: { position }, entries });

    frame(events);
    expect(shown).toEqual([
      { id: 'taiji', title: COPY.guide.taiji.title, body: COPY.guide.taiji.body },
    ]);

    position.set(20, -50, 20);
    frame(events);
    expect(hidden).toEqual(['taiji']);

    triggers.dispose();
    offShow();
    offHide();
  });

  it('停留在同一触发点时不重复发送 show', () => {
    const events = new EventBus<AppEventMap>();
    const position = new Vector3(3, 0, 4);
    const entries: readonly GuideEntry[] = [
      {
        id: 'puzhuang',
        copyKey: 'puzhuang',
        position: { x: 3, y: 0, z: 4 },
        radius: 5,
      },
    ];
    let showCount = 0;
    const offShow = events.on('guide:show', () => {
      showCount += 1;
    });
    const triggers = new GuideTriggers({ events, player: { position }, entries });

    frame(events);
    frame(events);
    expect(showCount).toBe(1);

    triggers.dispose();
    offShow();
  });
});
