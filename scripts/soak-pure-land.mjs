/** 连续采样段；以真实可见墙钟计时，不用加速逻辑时间冒充长测。调用 12 段 × 150 秒。 */
export async function soakPureLand(page, durationMs = 150000) {
  return page.evaluate(
    (durationMs) =>
      new Promise((resolve, reject) => {
        const g = window.__G;
        if (!g || document.hidden || g.landCamera.suspended || g.landCamera.modal)
          return reject(new Error('长测要求可见且活动的诊断页'));
        const histogram = new Uint32Array(1001);
        const start = performance.now();
        let previous = start,
          frames = 0,
          sum = 0,
          max = 0,
          hiddenMs = 0,
          hiddenSince = null,
          suspendedFrames = 0,
          renderedFrames = 0,
          lastLight = start;
        const visibility = () => {
          if (document.hidden) hiddenSince = performance.now();
          else if (hiddenSince !== null) {
            hiddenMs += performance.now() - hiddenSince;
            hiddenSince = null;
          }
        };
        document.addEventListener('visibilitychange', visibility);
        const removeFrame = g.events.on('app:frame', () => renderedFrames++);
        let longTaskCount = 0,
          longTaskMs = 0;
        const longTasks = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskCount++;
            longTaskMs += entry.duration;
            longTasks.push({ start: entry.startTime, duration: entry.duration });
            longTasks.sort((a, b) => b.duration - a.duration);
            if (longTasks.length > 20) longTasks.length = 20;
          }
        });
        observer.observe({ type: 'longtask' });
        const modes = ['dawn', 'noon', 'dusk'];
        let light = modes.indexOf(g.world.lighting.transition.target);
        g.events.emit('land:tour', { enabled: true });
        const snapshot = () => ({
          ...g.renderer.info.memory,
          programs: g.renderer.info.programs.length,
          canvases: document.querySelectorAll('canvas').length,
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          environmentBakes: g.world.lighting.environment.bakes,
          audio: {
            state: g.audio.context?.state ?? 'unallocated',
            sources: g.audio.noiseSources.length,
            oneShots: g.audio.oneShots.size,
          },
        });
        const before = snapshot();
        function tick(now) {
          const delta = now - previous;
          previous = now;
          if (g.landCamera.suspended || g.landCamera.modal) suspendedFrames++;
          frames++;
          sum += delta;
          max = Math.max(max, delta);
          histogram[Math.min(1000, Math.floor(delta))]++;
          if (now - lastLight >= 20000) {
            light = (light + 1) % modes.length;
            g.events.emit('tod:request', { to: modes[light] });
            lastLight = now;
          }
          if (window.__fatal || g.renderer.getContext().isContextLost()) {
            observer.disconnect();
            document.removeEventListener('visibilitychange', visibility);
            removeFrame();
            reject(new Error(`长测中断：${window.__fatal || 'context lost'}`));
          } else if (now - start >= durationMs) {
            observer.disconnect();
            document.removeEventListener('visibilitychange', visibility);
            removeFrame();
            let count = 0,
              p95 = 0;
            for (let i = 0; i < histogram.length; i++) {
              count += histogram[i];
              if (count >= frames * 0.95) {
                p95 = i + 1;
                break;
              }
            }
            resolve({
              elapsedMs: now - start,
              frames,
              meanMs: sum / frames,
              p95UpperMs: p95,
              maxMs: max,
              hiddenMs,
              suspendedFrames,
              renderedFrames,
              longTaskCount,
              longTaskMs,
              before,
              after: snapshot(),
              longTasks,
              viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
              quality: g.quality,
              view: g.landCamera.index,
            });
          } else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}
