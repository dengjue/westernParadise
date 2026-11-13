/** 仅注入 ?bench 诊断页。预分配逐帧表，结束时才转 JSON；不修改生产渲染参数。 */
export async function installLandFrameRecorder(page, { capacity = 24000, detailed = true } = {}) {
  if (!Number.isInteger(capacity) || capacity < 2) throw new RangeError('capacity 必须至少为 2');
  return page.evaluate(
    ({ capacity, detailed }) => {
      const g = window.__G;
      if (!g || window.__landFrames) throw new Error('需要空闲的诊断页');
      const columns = [
        'rafMs',
        'deltaMs',
        'appDeltaMs',
        'appFrames',
        'segment',
        'pipelineCpuMs',
        'gpuPublishedMs',
        'gpuSamples',
        'gpuDisjoints',
        'calls',
        'triangles',
        'shadowRequests',
        'reflectionUpdates',
        'reflectionRendered',
        'geometries',
        'textures',
        'programs',
        'activityMask',
        'probeMs',
        'logicalMs',
        'observedAtMs',
      ];
      const phases = window.__landPhases;
      const phaseOffset = columns.length;
      if (phases) columns.push(...phases.columns);
      const requestFrame = phases?.requestFrame ?? window.requestAnimationFrame.bind(window);
      const values = new Float64Array(capacity * columns.length);
      const segments = [],
        entries = [],
        activity = [],
        observers = [];
      const startedAt = performance.now();
      const initialViewport = [innerWidth, innerHeight, devicePixelRatio];
      let count = 0,
        rendered = 0,
        previousRendered = 0,
        appDelta = 0,
        logicalMs = 0;
      let previous = null,
        raf = 0,
        current = null,
        stopped = false,
        failure = null;
      let pending = null,
        entryOverflow = false;
      const removeFrame = g.events.on('app:frame', (frame) => {
        rendered++;
        appDelta = frame.deltaMs;
        logicalMs = frame.elapsedMs;
      });
      const mask = () =>
        Number(document.hidden) |
        (Number(!document.hasFocus()) * 2) |
        (Number(g.landCamera.suspended) * 4) |
        (Number(g.landCamera.modal) * 8) |
        (Number(!!window.__fatal) * 16) |
        (Number(
          innerWidth !== initialViewport[0] ||
            innerHeight !== initialViewport[1] ||
            devicePixelRatio !== initialViewport[2],
        ) *
          32);
      function onActivity(event) {
        activity.push({ type: event.type, atMs: performance.now(), mask: mask() });
      }
      document.addEventListener('visibilitychange', onActivity);
      window.addEventListener('blur', onActivity);
      window.addEventListener('focus', onActivity);
      window.addEventListener('resize', onActivity);
      function collect(list) {
        for (const entry of list) {
          // 观察器回调内才创建对象；上限确保异常页面不会无限增长诊断内存。
          if (entries.length === 2000) {
            entryOverflow = true;
            break;
          }
          entries.push(entry.toJSON());
        }
      }
      const supported = PerformanceObserver.supportedEntryTypes;
      for (const type of detailed ? ['longtask', 'long-animation-frame'] : []) {
        if (!supported.includes(type)) continue;
        const observer = new PerformanceObserver((list) => collect(list.getEntries()));
        observer.observe({ type, buffered: true });
        observers.push(observer);
      }
      const resources = () => ({
        ...g.renderer.info.memory,
        programs: g.renderer.info.programs.length,
        bakes: g.world.lighting.environment.bakes,
        shadowRequests: g.world.lighting.shadowRequests,
        reflectionUpdates: g.world.reflection.stats.updates,
      });
      function stop(reason) {
        if (stopped) return;
        stopped = true;
        failure = reason ?? null;
        cancelAnimationFrame(raf);
        clearTimeout(deadline);
        removeFrame();
        for (const observer of observers) {
          collect(observer.takeRecords());
          observer.disconnect();
        }
        document.removeEventListener('visibilitychange', onActivity);
        window.removeEventListener('blur', onActivity);
        window.removeEventListener('focus', onActivity);
        window.removeEventListener('resize', onActivity);
        if (pending) {
          const reject = pending.reject;
          pending = null;
          reject(new Error(reason || '采样提前停止'));
        }
      }
      function tick(now) {
        if (stopped) return;
        const begin = performance.now(),
          telemetry = g.renderBudget.telemetry;
        if (previous !== null) {
          const row = count * columns.length;
          values[row] = now;
          values[row + 1] = now - previous;
          values[row + 2] = appDelta;
          values[row + 3] = rendered - previousRendered;
          values[row + 4] = current?.id ?? -1;
          values[row + 5] = telemetry.cpuMs;
          values[row + 6] = telemetry.gpuMs ?? -1;
          values[row + 7] = telemetry.gpuSamples;
          values[row + 8] = telemetry.gpuDisjoints;
          values[row + 9] = g.renderer.info.render.calls;
          values[row + 10] = g.renderer.info.render.triangles;
          values[row + 11] = g.world.lighting.shadowRequests;
          values[row + 12] = g.world.reflection.stats.updates;
          values[row + 13] = Number(g.world.reflection.stats.rendered);
          values[row + 14] = g.renderer.info.memory.geometries;
          values[row + 15] = g.renderer.info.memory.textures;
          values[row + 16] = g.renderer.info.programs.length;
          values[row + 17] = mask();
          if (phases) values.set(phases.latest, row + phaseOffset);
          values[row + 18] = performance.now() - begin;
          values[row + 19] = logicalMs;
          values[row + 20] = performance.now();
          count++;
          if (phases && (phases.latest[1] !== now || phases.latest[6] !== 1)) {
            stop('分段计时与实际 RAF 未配对或调用栈无效');
            return;
          }
          if (mask()) {
            stop('采样中页面不可见、失焦、暂停或发生致命错误');
            return;
          }
          if (rendered - previousRendered !== 1) {
            stop('RAF 与应用绘制帧未一一对应');
            return;
          }
        }
        previous = now;
        previousRendered = rendered;
        if (
          pending &&
          (pending.frames > 0
            ? count - current.startRow >= pending.frames
            : !g.world.lighting.transition.active)
        ) {
          current.endMs = performance.now();
          current.endRow = count;
          current.after = resources();
          const resolve = pending.resolve;
          pending = null;
          current = null;
          resolve();
        }
        if (count === capacity) {
          stop('逐帧容量耗尽');
          return;
        }
        raf = requestFrame(tick);
      }
      // 一次注入覆盖单景点；无渲染/后台冻结也会有明确超时和已采集证据。
      const deadline = setTimeout(() => stop('单景点采样超过 150 秒'), 150000);
      raf = requestFrame(tick);
      window.__landFrames = {
        measure(step) {
          if (stopped || pending) throw new Error(failure || '存在未完成采样段');
          if (mask()) throw new Error('采样开始时页面不可见、失焦或暂停');
          current = {
            ...step,
            id: segments.length,
            startRow: count,
            startMs: performance.now(),
            before: resources(),
          };
          segments.push(current);
          if (step.to) {
            const before = Array.from(g.world.lighting.transition.weights);
            g.events.emit('tod:request', { to: step.to });
            current.requestMs = performance.now() - current.startMs;
            current.continuous = before.every(
              (value, i) => value === g.world.lighting.transition.weights[i],
            );
          }
          return new Promise((resolve, reject) => {
            pending = { resolve, reject, frames: step.frames ?? 0 };
          });
        },
        finish(reason) {
          stop(reason);
          const result = {
            schemaVersion: 1,
            startedAt,
            endedAt: performance.now(),
            failure,
            detailed,
            capacity,
            columns,
            frames: count,
            values: Array.from(values.subarray(0, count * columns.length)),
            segments,
            entries,
            entryOverflow,
            activity,
            startup: { ...g.startup, world: g.world.startup },
            environment: {
              url: location.href,
              timeOrigin: performance.timeOrigin,
              userAgent: navigator.userAgent,
              quality: g.quality,
              seed: g.seed,
              viewport: [innerWidth, innerHeight, devicePixelRatio],
              renderRatio: g.renderer.getPixelRatio(),
              drawingBuffer: [g.renderer.domElement.width, g.renderer.domElement.height],
              reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
              adaptiveLocked: g.renderBudget.adaptive.locked,
              gpuAvailable: g.renderBudget.telemetry.gpuAvailable,
              supportedEntries: supported,
            },
          };
          delete window.__landFrames;
          return result;
        },
      };
      return { startedAt, detailed, supportedEntries: supported };
    },
    { capacity, detailed },
  );
}
