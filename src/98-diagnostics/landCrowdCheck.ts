import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { LAND_JOURNEY, MULTIPLAYER } from '@/01-shared';
import { sampleLandHeight } from '@/02-core';
import type { CourtyardRemotePlayers } from '@/07-systems';

const STAGES = [0, 5, 15, 0] as const;
const WARMUP_MS = 2000;
const WINDOW_MS = 10000;

/** 单手机渲染对照。仅专用页面装配，角色数量即客户端邻居数量，不伪造在线人数。 */
export function mountLandCrowdCheck(
  parent: HTMLElement,
  remotes: CourtyardRemotePlayers,
  camera: PerspectiveCamera,
  quality: string,
) {
  const panel = document.createElement('output');
  panel.className = 'land-crowd-check';
  panel.style.cssText =
    'position:fixed;top:18%;left:50%;transform:translateX(-50%);z-index:20;pointer-events:none;background:#142323ed;color:white;padding:.5em .8em;font:13px/1.5 system-ui;text-align:center;white-space:pre';
  parent.append(panel);
  const point = new Vector3();
  const results: string[] = [];
  const intervals: number[] = [];
  const [entryX, entryZ] = LAND_JOURNEY.entries[0];
  let stage = 0,
    seq = 0,
    warmup = NaN,
    last = NaN,
    lastPose = -Infinity,
    width = 0,
    height = 0;
  let inView = true;
  const title = '单机模拟 · 入口同屏渲染';
  function reset() {
    if (stage >= STAGES.length) return;
    warmup = last = NaN;
    lastPose = -Infinity;
    intervals.length = 0;
    panel.textContent = `${title}\n等待前台步行画面`;
  }
  reset();
  return {
    reset,
    prepare(now: number) {
      const count = STAGES[stage];
      if (count === undefined) return;
      if (now - lastPose >= MULTIPLAYER.tickMs) {
        lastPose = now;
        inView = true;
        const changed = Array.from({ length: count }, (_, i) => {
          const phase = now / 600 + i;
          const x = entryX + ((i % 5) - 2) * 0.9 + Math.sin(phase) * 0.2;
          const z = entryZ - 9 - Math.floor(i / 5) * 2;
          const y = sampleLandHeight(x, z, true)!;
          point.set(x, y + 0.8, z).project(camera);
          if (Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) >= 1)
            inView = false;
          return {
            id: String(i + 1),
            x,
            y,
            z,
            yaw: Math.cos(phase) > 0 ? Math.PI / 2 : -Math.PI / 2,
          };
        });
        remotes.apply({ type: 'snapshot', tick: ++seq, changed, removed: [] }, now);
      }
      remotes.update(now);
    },
    frame(now: number, w: number, h: number) {
      const count = STAGES[stage];
      if (count === undefined) return;
      if (!inView) {
        reset();
        panel.textContent = `${title}\n队形未完整入镜，请横屏或刷新重试`;
        return;
      }
      if (!Number.isFinite(warmup) || w !== width || h !== height) {
        width = w;
        height = h;
        warmup = now;
        last = NaN;
        intervals.length = 0;
        panel.textContent = `${title}\n${stage + 1}/4 · ${count} 个陪测角色 · 请保持页面前台`;
      }
      if (now - warmup < WARMUP_MS) return;
      if (Number.isFinite(last)) intervals.push(now - last);
      last = now;
      if (!intervals.length || now - warmup < WARMUP_MS + WINDOW_MS) return;
      const elapsed = intervals.reduce((sum, dt) => sum + dt, 0);
      if (elapsed < WINDOW_MS) return;
      intervals.sort((a, b) => a - b);
      const p95 = intervals[Math.ceil(intervals.length * 0.95) - 1]!;
      results.push(
        `${count} 人 · ${((1000 * intervals.length) / elapsed).toFixed(1)} FPS · ${p95.toFixed(1)} ms · ${w}×${h}`,
      );
      stage++;
      remotes.clear();
      reset();
      if (stage === STAGES.length)
        panel.textContent = `${title} · ${quality}\n平均 FPS / P95 帧间隔 / 分辨率\n${results.join('\n')}\n已完成 · 可截图`;
    },
    dispose() {
      panel.remove();
    },
  };
}
