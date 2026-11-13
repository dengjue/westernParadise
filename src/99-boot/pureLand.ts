import type { AppEventMap } from '@/00-types';
import { COPY, PURE_LAND, QUALITY_PROFILES, WEATHER_PRESETS } from '@/01-shared';
import { Clock, EventBus } from '@/02-core';
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
import { createCinematicPipeline, createSceneContext, Loop } from '@/04-engine';
import { createPureLandWorld } from '@/06-world';
import { KeyboardMouseInput, LandCamera, TouchInput } from '@/07-systems';
import { mountPureLandUi } from '@/08-ui';
import { installDebugProbe, installFatalTrap, markFatal } from '@/98-diagnostics';

/** 新世界独立装配，历史庭院仍可通过 scene=courtyard 复现。 */
export function startPureLand(): () => void {
  const root = document.getElementById('app');
  if (!root) throw new Error('缺少 #app 挂载点');
  const params = parseParams(window.location.search);
  const raw = new URLSearchParams(window.location.search);
  const capabilities = detectCapabilities(readBrowserEnv());
  const storage = resolveStorage();
  const decision = selectQuality(params, capabilities, readStoredQuality(storage));
  writeStoredQuality(storage, decision.tier);
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
  });
  const pipeline = createCinematicPipeline(
    renderer,
    context.scene,
    context.camera,
    decision.tier,
    window.innerWidth,
    window.innerHeight,
  );
  const input = capabilities.touch
    ? new TouchInput({
        moveTarget: ui.move,
        lookTarget: ui.look,
        pointerTarget: window,
        moveRadiusPx: 46,
        lookSensitivityRadPerPixel: 0.004,
      })
    : new KeyboardMouseInput({
        keyboardTarget: window,
        pointerTarget: window,
        lookSensitivityRadPerPixel: 0.003,
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
  });
  events.emit('audio:request', { enabled: false });
  renderer.info.autoReset = false;
  const loop = new Loop({
    clock: new Clock(1000 / 60, 150),
    events,
    onStep: (delta) => {
      camera.update(delta);
      audio.update(delta);
      if (!capabilities.reducedMotion) world.update(delta);
    },
    onRender: () => {
      renderer.info.reset();
      pipeline.render();
    },
  });
  const removeTime = events.on('tod:request', ({ to }) => {
    const from = time;
    time = to;
    world.setTime(to);
    events.emit('tod:changed', { from, to });
  });
  const removeTrap = installFatalTrap((phase, error) => {
    loop.stop();
    markFatal(error.message);
    ui.showNotice(`${phase}: ${error.message}`);
  });
  const resize = (): void => {
    context.resize(window.innerWidth, window.innerHeight);
    pipeline.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  const visibility = (): void => {
    if (document.hidden) loop.stop();
    else loop.start();
  };
  document.addEventListener('visibilitychange', visibility);
  const contextLost = (event: Event): void => {
    event.preventDefault();
    loop.stop();
    ui.showNotice('画面连接暂时中断，请刷新页面恢复。');
  };
  context.canvas.addEventListener('webglcontextlost', contextLost);
  if (capabilities.reducedMotion) ui.showNotice(COPY.reducedMotion);
  else if (decision.tier === 'low') ui.showNotice('流畅画质 · 已降低反射与叶片密度');
  installDebugProbe(import.meta.env.DEV || params.debug, {
    scene: context.scene,
    camera: context.camera,
    renderer,
    events,
    world,
    landCamera: camera,
    audio,
    quality: decision.tier,
    seed: params.seed,
  });
  loop.start();
  events.emit('app:ready', { startedAt: Date.now() });
  function dispose(): void {
    loop.stop();
    removeTime();
    removeTrap();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('visibilitychange', visibility);
    context.canvas.removeEventListener('webglcontextlost', contextLost);
    input.dispose();
    camera.dispose();
    audio.dispose();
    world.dispose();
    pipeline.dispose();
    context.dispose();
    ui.dispose();
    events.clear();
  }
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
