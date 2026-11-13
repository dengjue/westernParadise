import type { AppEventMap } from '@/00-types';
import {
  COPY,
  LAND_JOURNEY,
  LAND_RENDER,
  LAND_SOUND,
  PURE_LAND,
  QUALITY_PROFILES,
  WEATHER_PRESETS,
} from '@/01-shared';
import { AdaptiveRenderBudget, Clock, EventBus } from '@/02-core';
import {
  AmbientAudio,
  detectCapabilities,
  parseParams,
  readBrowserEnv,
  readStoredQuality,
  resolveStorage,
  selectQuality,
  writeStoredQuality,
} from '@/03-platform';
import { createCinematicPipeline, createSceneContext, Loop, RenderTelemetry } from '@/04-engine';
import { createPureLandWorld } from '@/06-world';
import { KeyboardMouseInput, LandCamera, TouchInput } from '@/07-systems';
import { mountPureLandUi } from '@/08-ui';
import { installDebugProbe, installFatalTrap, markFatal } from '@/98-diagnostics';

/** 新世界独立装配，历史庭院仍可通过 scene=courtyard 复现。 */
export function startPureLand(): () => void {
  const start = performance.now();
  const startup = { syncMs: 0, firstFrameMs: 0 };
  const root = document.getElementById('app');
  if (!root) throw new Error('缺少 #app 挂载点');
  const params = parseParams(window.location.search);
  const raw = new URLSearchParams(window.location.search);
  const capabilities = detectCapabilities(readBrowserEnv());
  const storage = resolveStorage();
  const storedQuality = readStoredQuality(storage);
  const decision = selectQuality(params, capabilities, storedQuality);
  if (params.quality !== null) writeStoredQuality(storage, decision.tier);
  const adaptive = new AdaptiveRenderBudget(params.quality !== null || storedQuality !== null);
  const profile = {
    ...QUALITY_PROFILES[decision.tier],
    pixelRatioCap:
      decision.tier === 'ultra'
        ? 1.75
        : Math.min(1.5, QUALITY_PROFILES[decision.tier].pixelRatioCap),
  };
  let time = raw.has('tod') ? params.tod : ('dawn' as const);
  const events = new EventBus<AppEventMap>();
  const ui = mountPureLandUi(root, {
    events,
    capabilities,
    quality: decision.tier,
    time,
    noAudio: params.noAudio,
  });
  document.title = '西方极乐 · 一念清净，万象庄严';
  if (capabilities.webgl === 'none') throw new Error(COPY.noWebgl);
  const context = createSceneContext(ui.viewport, {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: capabilities.pixelRatio,
    profile,
  });
  const renderer = context.rendering.renderer;
  Object.assign(context.camera, { fov: PURE_LAND.fov, near: PURE_LAND.near, far: PURE_LAND.far });
  context.camera.updateProjectionMatrix();
  const world = createPureLandWorld(context.scene, {
    canvasFactory: (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    renderer,
    quality: decision.tier,
    anisotropy: profile.anisotropy,
    seed: params.seed,
    time,
    reducedMotion: capabilities.reducedMotion,
    cellSize:
      (params.bench || params.debug) && raw.get('chunk') === '24'
        ? LAND_RENDER.cellCandidates[0]
        : LAND_RENDER.cellSize,
  });
  const pipeline = createCinematicPipeline(
    renderer,
    context.scene,
    context.camera,
    decision.tier,
    window.innerWidth,
    window.innerHeight,
  );
  const telemetry = new RenderTelemetry(renderer, params.bench || params.debug);
  const basePixelRatio = renderer.getPixelRatio();
  let elapsedMs = 0;
  const removeBudget = events.on('app:frame', (frame) => {
    elapsedMs = frame.elapsedMs;
    if (adaptive.update(frame.deltaMs)) {
      renderer.setPixelRatio(basePixelRatio * adaptive.scale);
      pipeline.setScale(adaptive.scale);
      world.reflection.setScale(adaptive.scale);
    }
  });
  const input = capabilities.touch
    ? new TouchInput({
        moveTarget: ui.move,
        lookTarget: ui.look,
        pointerTarget: window,
        moveRadiusPx: LAND_JOURNEY.moveRadiusPx,
        lookSensitivityRadPerPixel: LAND_JOURNEY.touchSensitivity,
        feedback: ui.touchFeedback,
      })
    : new KeyboardMouseInput({
        keyboardTarget: window,
        pointerTarget: window,
        lookSensitivityRadPerPixel: LAND_JOURNEY.mouseSensitivity,
      });
  const camera = new LandCamera(context.camera, input, events, capabilities.reducedMotion);
  const audio = new AmbientAudio({
    eventTarget: window,
    events,
    contextFactory: () => new AudioContext(),
    seed: params.seed,
    weather: WEATHER_PRESETS.clear,
    weatherPresets: WEATHER_PRESETS,
    noAudio: params.noAudio,
    spatial: true,
  });
  events.emit('audio:request', { enabled: false });
  let audioElapsed = LAND_SOUND.updateMs;
  const audioPosition = { x: 0, y: 0, z: 0 };
  renderer.info.autoReset = false;
  const loop = new Loop({
    clock: new Clock(1000 / 60, 150),
    events,
    onStep: (delta) => {
      camera.update(delta);
      audioElapsed += delta;
      if (audioElapsed >= LAND_SOUND.updateMs) {
        audioElapsed %= LAND_SOUND.updateMs;
        Object.assign(audioPosition, context.camera.position);
        events.emit('audio:position', audioPosition);
      }
      audio.update(delta);
      if (!capabilities.reducedMotion) world.update(delta);
    },
    onRender: () => {
      renderer.info.reset();
      world.reflection.beginFrame(elapsedMs);
      telemetry.begin(performance.now());
      try {
        pipeline.render();
        if (startup.firstFrameMs === 0) startup.firstFrameMs = performance.now() - start;
      } finally {
        telemetry.end(performance.now());
      }
    },
  });
  const removeTime = events.on('tod:request', ({ to }) => {
    const from = time;
    time = to;
    world.setTime(to);
    events.emit('tod:changed', { from, to });
  });
  let modal = false,
    lost = false,
    failed = false;
  const removeModal = events.on('land:modal', ({ open }) => {
    modal = open;
    syncActivity();
  });
  const removeTrap = installFatalTrap((phase, error) => {
    failed = true;
    loop.stop();
    syncActivity();
    markFatal(error.message);
    ui.showNotice(`${phase}: ${error.message}`);
  });
  const resize = (): void => {
    context.resize(window.innerWidth, window.innerHeight);
    pipeline.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  function syncActivity(): void {
    const suspended = document.hidden || !document.hasFocus() || lost || failed;
    input.setEnabled(!modal && !suspended);
    events.emit('land:suspend', { suspended });
    if (document.hidden || lost || failed) loop.stop();
    else loop.start();
  }
  const visibility = (): void => syncActivity();
  const pageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) {
      dispose();
      return;
    }
    input.setEnabled(false);
    events.emit('land:suspend', { suspended: true });
    loop.stop();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', visibility);
  window.addEventListener('focus', visibility);
  window.addEventListener('pageshow', visibility);
  const contextLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    loop.stop();
    syncActivity();
    ui.showNotice('画面连接暂时中断，请刷新页面恢复。');
  };
  context.canvas.addEventListener('webglcontextlost', contextLost);
  if (capabilities.reducedMotion) ui.showNotice(COPY.reducedMotion, true);
  else if (decision.tier === 'low') ui.showNotice('流畅画质 · 已降低反射与叶片密度', true);
  let disposed = false;
  installDebugProbe(import.meta.env.DEV || params.debug || params.bench, {
    scene: context.scene,
    camera: context.camera,
    renderer,
    events,
    world,
    landCamera: camera,
    audio,
    quality: decision.tier,
    seed: params.seed,
    renderBudget: { adaptive, pipeline: pipeline.stats, telemetry: telemetry.stats },
    startup,
    // 仅诊断页暴露真实释放/重挂入口，回归检测同一文档里的资源与监听器，而非只测刷新。
    dispose,
    restart: () => {
      dispose();
      return startPureLand();
    },
  });
  startup.syncMs = performance.now() - start;
  syncActivity();
  events.emit('app:ready', { startedAt: Date.now() });
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    loop.stop();
    removeTime();
    removeBudget();
    removeTrap();
    removeModal();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', pageHide);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('blur', visibility);
    window.removeEventListener('focus', visibility);
    window.removeEventListener('pageshow', visibility);
    context.canvas.removeEventListener('webglcontextlost', contextLost);
    input.dispose();
    camera.dispose();
    audio.dispose();
    world.dispose();
    pipeline.dispose();
    telemetry.dispose();
    context.dispose();
    ui.dispose();
    events.clear();
  }
  window.addEventListener('pagehide', pageHide);
  return dispose;
}
