import { createSoakTimeline } from './land-soak-timeline.mjs';

/** 连续采集跨越 CLI 请求边界；一次安装，12 次取段。诊断专用，不改变生产循环。 */
export async function installLandSoak(
  page,
  { segmentMs = 150000, segments = 12, capacity = 24000 } = {},
) {
  if (
    !Number.isFinite(segmentMs) ||
    segmentMs < 100 ||
    segmentMs > 150000 ||
    !Number.isInteger(segments) ||
    segments < 1 ||
    segments > 12
  )
    throw new RangeError('长测段长/段数无效');
  await page.evaluate(() => {
    if (
      !window.__G ||
      window.__landSoak ||
      window.__landSoakTimeline ||
      window.__landFrames ||
      window.__landPhases
    )
      throw new Error('需要空闲的诊断页');
  });
  await page.evaluate(createSoakTimeline, { capacity, install: true });
  return page.evaluate(
    ({ segmentMs, segments }) => {
      const g = window.__G,
        timeline = window.__landSoakTimeline;
      const viewport = [innerWidth, innerHeight, devicePixelRatio],
        ratio = g.renderer.getPixelRatio(),
        audioExpected = g.audio.context?.state === 'running';
      const initial = {
        timeOrigin: performance.timeOrigin,
        url: location.href,
        userAgent: navigator.userAgent,
        viewport,
        drawingBuffer: [g.renderer.domElement.width, g.renderer.domElement.height],
        renderRatio: ratio,
        quality: g.quality,
        seed: g.seed,
        gpuAvailable: g.renderBudget.telemetry.gpuAvailable,
      };
      const mask = () =>
        Number(document.hidden) |
        (Number(!document.hasFocus()) * 2) |
        (Number(g.landCamera.suspended) * 4) |
        (Number(g.landCamera.modal) * 8) |
        (Number(!!window.__fatal) * 16) |
        (Number(
          innerWidth !== viewport[0] ||
            innerHeight !== viewport[1] ||
            devicePixelRatio !== viewport[2] ||
            g.renderer.getPixelRatio() !== ratio,
        ) *
          32) |
        (Number(window.__G !== g) * 64) |
        (Number(g.renderer.getContext().isContextLost()) * 128) |
        (Number(audioExpected && g.audio.context?.state !== 'running') * 512);
      if (mask() || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        delete window.__landSoakTimeline;
        throw new Error('长测要求可见、聚焦、普通动效且未暂停');
      }
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
      const queue = [],
        activity = [],
        modes = ['dawn', 'noon', 'dusk'];
      let rendered = 0,
        previousRendered = 0,
        raf = 0,
        stopped = false,
        failure = null,
        index = 0,
        waiter = null,
        deadline = null,
        lastLight = null,
        light = modes.indexOf(g.world.lighting.transition.target),
        switches = 0,
        views = 0,
        before = snapshot();
      const removeFrame = g.events.on('app:frame', () => rendered++);
      const wasTouring = g.landCamera.touring;
      g.events.emit('land:tour', { enabled: true });
      function onActivity(event) {
        const state = mask();
        if (activity.length < 64)
          activity.push({ type: event.type, atMs: performance.now(), mask: state });
        else {
          finish('活动事件容量耗尽');
          return;
        }
        if (state) finish('采样失焦、隐藏、暂停或视口发生漂移');
      }
      function cleanup() {
        cancelAnimationFrame(raf);
        clearTimeout(deadline);
        removeFrame();
        document.removeEventListener('visibilitychange', onActivity);
        window.removeEventListener('blur', onActivity);
        window.removeEventListener('focus', onActivity);
        window.removeEventListener('resize', onActivity);
        if (window.__G === g) g.events.emit('land:tour', { enabled: wasTouring });
        delete window.__landSoakTimeline;
      }
      function publish() {
        if (!timeline.frames) return;
        const segment = {
          ...timeline.take(),
          index: ++index,
          failure,
          before,
          after: snapshot(),
          switches,
          views,
          activity: activity.splice(0),
          environment: initial,
        };
        before = segment.after;
        switches = views = 0;
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve(segment);
        } else queue.push(segment);
      }
      function finish(reason = null) {
        if (stopped) return;
        failure = reason;
        stopped = true;
        try {
          publish();
        } finally {
          cleanup();
        }
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve(terminal());
        }
      }
      function armDeadline() {
        clearTimeout(deadline);
        deadline = setTimeout(() => finish('没有按期取得连续绘制帧'), segmentMs + 10000);
      }
      function tick(now) {
        if (stopped) return;
        try {
          const state = mask() | (Number(!g.landCamera.touring) * 256),
            appFrames = rendered - previousRendered;
          const r = g.renderer.info.render;
          timeline.append(
            now,
            appFrames,
            g.renderBudget.telemetry.cpuMs,
            r.calls,
            r.triangles,
            Number(g.world.reflection.stats.rendered),
            g.world.lighting.shadowRequests,
            state,
            g.landCamera.index,
            modes.indexOf(g.world.lighting.transition.target),
            Number(g.world.lighting.transition.active),
          );
          previousRendered = rendered;
          if (state || (timeline.frames && appFrames !== 1)) {
            finish('活动性或 RAF/实际绘制帧对应失效');
            return;
          }
          if (lastLight === null) lastLight = now;
          if (now - lastLight >= 20000) {
            light = (light + 1) % modes.length;
            g.events.emit('tod:request', { to: modes[light] });
            lastLight = now;
            switches++;
          }
          views |= 1 << g.landCamera.index;
          if (timeline.elapsedMs >= segmentMs) {
            publish();
            if (index >= segments) {
              stopped = true;
              cleanup();
              return;
            }
            if (queue.length >= 2) {
              finish('宿主未及时取段，停止以限制诊断内存');
              return;
            }
            armDeadline();
          }
          raf = requestAnimationFrame(tick);
        } catch (error) {
          finish(String(error));
        }
      }
      document.addEventListener('visibilitychange', onActivity);
      window.addEventListener('blur', onActivity);
      window.addEventListener('focus', onActivity);
      window.addEventListener('resize', onActivity);
      armDeadline();
      raf = requestAnimationFrame(tick);
      function terminal() {
        return {
          failure: failure || '长测已结束',
          frames: 0,
          environment: initial,
          activity: [...activity],
        };
      }
      window.__landSoak = {
        initial,
        next() {
          if (waiter) throw new Error('存在未完成的取段请求');
          if (queue.length) return Promise.resolve(queue.shift());
          if (stopped) return Promise.resolve(terminal());
          return new Promise((resolve) => {
            waiter = resolve;
          });
        },
        finish,
        // 取消/异常时也导出尚未取走的完整段和部分段，不能因清理而丢失失败证据。
        drain() {
          return queue.splice(0);
        },
        status() {
          return {
            stopped,
            failure,
            completedSegments: index,
            queuedSegments: queue.length,
            pendingRead: !!waiter,
          };
        },
      };
      return initial;
    },
    { segmentMs, segments },
  );
}

export async function takeLandSoakSegment(page) {
  return page.evaluate(async () => {
    if (!window.__landSoak) throw new Error('连续长测未安装');
    const segment = await window.__landSoak.next();
    const exportStartMs = performance.now();
    if (segment.values) segment.values = Array.from(segment.values);
    segment.export = { startMs: exportStartMs, endMs: performance.now() };
    return segment;
  });
}

export async function finishLandSoak(page, reason = '宿主结束采集') {
  return page.evaluate((reason) => {
    const recorder = window.__landSoak;
    if (!recorder) return null;
    recorder.finish(reason);
    const status = recorder.status();
    const remaining = recorder
      .drain()
      .map((segment) => ({ ...segment, values: Array.from(segment.values) }));
    delete window.__landSoak;
    return { status, remaining, removed: !window.__landSoak && !window.__landSoakTimeline };
  }, reason);
}
