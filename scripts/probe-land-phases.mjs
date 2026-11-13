import { createPhaseClock } from './phase-clock.mjs';

export const phaseNames = [
  'cameraUpdate',
  'worldUpdate',
  'audioUpdate',
  'gpuDisjoint',
  'gpuAvailable',
  'gpuResult',
  'gpuBegin',
  'gpuEnd',
  'mainScene',
  'shadowMain',
  'reflection',
  'reflectionScene',
  'shadowReflection',
  'shadowCheck',
  'postDraw',
  'targetSwitch',
  'clear',
];
const submissionNames = [
  'matrixMain',
  'matrixReflection',
  'submitMain',
  'submitReflection',
  'submitShadow',
  'submitPost',
  'glDraw',
  'glBufferUpload',
  'glCompile',
  'glShaderStatus',
];

/** 两种条件均真实释放后重挂；只在构造 telemetry 的同步区间屏蔽计时扩展。 */
export async function configureLandGpuQueries(page, enabled) {
  return page.evaluate((enabled) => {
    const g = window.__G;
    if (!g || window.__landFrames || window.__landPhases) throw new Error('需要空闲诊断页');
    const prototype = WebGL2RenderingContext.prototype;
    const original = prototype.getExtension;
    let filtered = 0;
    try {
      if (!enabled)
        prototype.getExtension = function (name) {
          if (name.toLowerCase() === 'ext_disjoint_timer_query_webgl2') {
            filtered++;
            return null;
          }
          return original.call(this, name);
        };
      g.restart();
    } finally {
      prototype.getExtension = original;
    }
    const current = window.__G;
    return {
      enabled,
      filtered,
      gpuAvailable: current.renderBudget.telemetry.gpuAvailable,
      extensionRestored: prototype.getExtension === original,
      remounted: current !== g,
      canvases: document.querySelectorAll('canvas').length,
    };
  }, enabled);
}

/** 可撤销外部探针；仅包装既有调用，不增加 WebGL 查询、finish 或绘制。 */
export async function installLandPhaseProbe(
  page,
  { queryCapacity = 24000, submission = false } = {},
) {
  if (!Number.isInteger(queryCapacity) || queryCapacity < 1)
    throw new RangeError('queryCapacity 无效');
  await page.evaluate(() => {
    if (!window.__G || window.__landPhases || window.__landPhaseClock)
      throw new Error('需要空闲诊断页，不能叠加分段探针');
  });
  const names = submission ? [...phaseNames, ...submissionNames] : phaseNames;
  await page.evaluate(createPhaseClock, { names, install: true });
  return page.evaluate(
    ({ names, queryCapacity, submission }) => {
      const g = window.__G,
        clock = window.__landPhaseClock;
      if (!g || !clock || window.__landPhases) throw new Error('需要空闲诊断页与计时栈');
      const ids = Object.fromEntries(names.map((name, id) => [name, id]));
      const columns = [
        'phaseFrame',
        'phaseRafMs',
        'appStartMs',
        'appEndMs',
        'appMs',
        'unattributedMs',
        'phaseValid',
      ];
      for (const name of names)
        columns.push(`${name}InclusiveMs`, `${name}ExclusiveMs`, `${name}Calls`);
      const latest = new Float64Array(columns.length);
      const queryValues = new Float64Array(queryCapacity * 3),
        queryFrames = new Map();
      const patches = [],
        callbacks = new WeakMap();
      const originalRaf = window.requestAnimationFrame;
      let enabled = true,
        tracking = false,
        isApp = false,
        sequence = 0;
      let queryCount = 0,
        queryOverflow = false,
        disjoints = 0,
        invalidFrames = 0;
      // 这些枚举由 WebGL 扩展规范定义；只比较已经发生的调用，不额外读取 GPU 状态。
      const gpuDisjoint = 0x8fbb,
        timeElapsed = 0x88bf;
      const gl = g.renderer.getContext();
      function patch(object, key, replacement) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        const original = object[key];
        object[key] = replacement;
        patches.push({ object, key, descriptor, original, replacement });
      }
      function wrap(object, key, select, exactArguments = false) {
        const original = object[key];
        patch(object, key, function (a, b, c, d, e, f) {
          if (!enabled || !tracking)
            return exactArguments
              ? original.apply(this, arguments)
              : original.call(this, a, b, c, d, e, f);
          const id = select(a, b);
          if (id < 0) return original.call(this, a, b, c, d, e, f);
          clock.enter(id, performance.now());
          let value;
          try {
            // bufferData 的 WebIDL 重载依赖实参数量，不能补 undefined 改变重载选择。
            value = exactArguments
              ? original.apply(this, arguments)
              : original.call(this, a, b, c, d, e, f);
            return value;
          } finally {
            clock.leave(performance.now());
            if (id === ids.gpuBegin) queryFrames.set(b, sequence + 1);
            if (id === ids.gpuDisjoint && value) {
              disjoints++;
              for (const query of queryFrames.keys()) queryFrames.set(query, -1);
            }
            if (id === ids.gpuResult) {
              if (queryCount < queryCapacity) {
                const offset = queryCount++ * 3;
                queryValues[offset] = queryFrames.get(a) ?? -1;
                queryValues[offset + 1] = sequence + 1;
                queryValues[offset + 2] = value / 1e6;
              } else queryOverflow = true;
            }
          }
        });
      }
      const removeFrame = g.events.on('app:frame', () => {
        if (tracking) isApp = true;
      });
      try {
        const water = g.scene.getObjectByName('seven-jewel-water');
        if (!water) throw new Error('未找到水面反射对象');
        wrap(g.landCamera, 'update', () => ids.cameraUpdate);
        wrap(g.world, 'update', () => ids.worldUpdate);
        wrap(g.audio, 'update', () => ids.audioUpdate);
        wrap(gl, 'getParameter', (parameter) => (parameter === gpuDisjoint ? ids.gpuDisjoint : -1));
        wrap(gl, 'getQueryParameter', (_query, parameter) =>
          parameter === gl.QUERY_RESULT_AVAILABLE
            ? ids.gpuAvailable
            : parameter === gl.QUERY_RESULT
              ? ids.gpuResult
              : -1,
        );
        wrap(gl, 'beginQuery', (target) => (target === timeElapsed ? ids.gpuBegin : -1));
        wrap(gl, 'endQuery', (target) => (target === timeElapsed ? ids.gpuEnd : -1));
        wrap(g.renderer, 'render', (scene, camera) =>
          scene === g.scene
            ? camera === g.camera
              ? ids.mainScene
              : ids.reflectionScene
            : ids.postDraw,
        );
        wrap(g.renderer.shadowMap, 'render', (lights) => {
          const shadow = g.renderer.shadowMap;
          if (!shadow.enabled || (!shadow.autoUpdate && !shadow.needsUpdate) || lights.length === 0)
            return ids.shadowCheck;
          return clock.active[ids.reflection] ? ids.shadowReflection : ids.shadowMain;
        });
        wrap(water, 'onBeforeRender', () => ids.reflection);
        wrap(g.renderer, 'setRenderTarget', () => ids.targetSwitch);
        wrap(g.renderer, 'clear', () => ids.clear);
        if (submission) {
          wrap(g.scene, 'updateMatrixWorld', () =>
            clock.active[ids.reflection] ? ids.matrixReflection : ids.matrixMain,
          );
          wrap(g.renderer, 'renderBufferDirect', () => {
            if (clock.active[ids.shadowMain] || clock.active[ids.shadowReflection])
              return ids.submitShadow;
            if (clock.active[ids.reflectionScene]) return ids.submitReflection;
            return clock.active[ids.mainScene] ? ids.submitMain : ids.submitPost;
          });
          for (const name of [
            'drawArrays',
            'drawElements',
            'drawArraysInstanced',
            'drawElementsInstanced',
          ])
            wrap(gl, name, () => ids.glDraw);
          for (const name of ['bufferData', 'bufferSubData'])
            wrap(gl, name, () => ids.glBufferUpload, true);
          for (const name of ['compileShader', 'linkProgram']) wrap(gl, name, () => ids.glCompile);
          for (const name of ['getShaderParameter', 'getProgramParameter'])
            wrap(gl, name, () => ids.glShaderStatus);
        }
        patch(window, 'requestAnimationFrame', function (callback) {
          let wrapped = callbacks.get(callback);
          if (!wrapped) {
            wrapped = function (now) {
              if (!enabled) return callback(now);
              clock.reset();
              isApp = false;
              tracking = true;
              const start = performance.now();
              try {
                return callback(now);
              } finally {
                const end = performance.now();
                tracking = false;
                if (isApp) {
                  let accounted = 0;
                  for (let i = 0; i < names.length; i++) {
                    latest[7 + i * 3] = clock.inclusive[i];
                    latest[8 + i * 3] = clock.exclusive[i];
                    latest[9 + i * 3] = clock.calls[i];
                    accounted += clock.exclusive[i];
                  }
                  const valid = clock.valid && accounted <= end - start + 0.000001;
                  if (!valid) invalidFrames++;
                  latest[0] = ++sequence;
                  latest[1] = now;
                  latest[2] = start;
                  latest[3] = end;
                  latest[4] = end - start;
                  latest[5] = end - start - accounted;
                  latest[6] = Number(valid);
                }
              }
            };
            callbacks.set(callback, wrapped);
          }
          return originalRaf.call(window, wrapped);
        });
      } catch (error) {
        restore();
        delete window.__landPhaseClock;
        throw error;
      }
      function restore() {
        enabled = false;
        removeFrame();
        let restored = 0;
        for (const patch of patches.toReversed()) {
          if (patch.object[patch.key] !== patch.replacement) continue;
          if (patch.descriptor) Object.defineProperty(patch.object, patch.key, patch.descriptor);
          else delete patch.object[patch.key];
          if (patch.object[patch.key] === patch.original) restored++;
        }
        return { expected: patches.length, restored };
      }
      window.__landPhases = {
        columns,
        latest,
        // 记录器使用原生 RAF，防止把读取和序列化开销算进应用回调。
        requestFrame: (callback) => originalRaf.call(window, callback),
        finish() {
          const cleanup = restore();
          const result = {
            names,
            submission,
            columns,
            frames: sequence,
            invalidFrames,
            disjoints,
            queryOverflow,
            queryColumns: ['sourceFrame', 'publishedFrame', 'gpuMs'],
            queries: queryCount,
            queryValues: Array.from(queryValues.subarray(0, queryCount * 3)),
            cleanup,
          };
          delete window.__landPhases;
          delete window.__landPhaseClock;
          return result;
        },
      };
      return { columns, queryCapacity, patches: patches.length };
    },
    { names, queryCapacity, submission },
  );
}
