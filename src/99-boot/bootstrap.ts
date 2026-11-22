import type { AppEventMap } from '@/00-types';
import {
  APP,
  COPY,
  COURTYARD_MULTIPLAYER_COPY,
  GUIDE_ENTRIES,
  QUALITY_PROFILES,
  RENDER,
  TIME_OF_DAY_PRESETS,
  WEATHER_PRESETS,
  WORLD,
  createRegistry,
} from '@/01-shared';
import { Clock, EventBus, Logger, Rng, toError } from '@/02-core';
import {
  detectCapabilities,
  AmbientAudio,
  CourtyardMultiplayerClient,
  courtyardMultiplayerUrl,
  parseParams,
  readBrowserEnv,
  readStoredQuality,
  resolveStorage,
  selectQuality,
} from '@/03-platform';
import type { CourtyardMultiplayerStatus } from '@/03-platform';
import { createSceneContext, Loop } from '@/04-engine';
import { createCourtyardWorld, LightingRig, SkyDome } from '@/06-world';
import {
  Character,
  CourtyardRemotePlayers,
  FollowCamera,
  GuideTriggers,
  KeyboardMouseInput,
  StaticColliders,
  TouchInput,
} from '@/07-systems';
import type { InputSource } from '@/07-systems';
import { mountUi } from '@/08-ui';
import { installDebugProbe, installFatalTrap, markFatal } from '@/98-diagnostics';
import { startPureLand } from './pureLand';

/**
 * 唯一装配层。
 *
 * 参考件的 99-boot 第一句就 selectGameMap() 锁定配置、之后再不改写；
 * 这里沿用同一原则：所有环境探测、参数解析、画质决策**只在此处发生一次**，
 * 然后把冻结后的结果传给各层。其余模块不得自行读取 window 或改写配置。
 *
 * 返回 dispose 函数，页面卸载时统一释放，便于将来做热重载与自动化测试。
 */

function noop(): void {
  // 启动失败或减动效场景下没有需要执行/释放的动作，保留具名空函数便于阅读。
}

function createAudioContext(): AudioContext {
  const audioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (audioContextConstructor === undefined) {
    throw new Error('当前浏览器不支持 Web Audio API');
  }
  return new audioContextConstructor();
}

/** 连 UI 都挂不上时的最后兜底：绝不白屏。 */
function showFallbackFatal(detail: string): void {
  try {
    markFatal(detail);
    const root = document.getElementById('app') ?? document.body;
    const panel = document.createElement('div');
    panel.className = 'fatal';
    const heading = document.createElement('h1');
    heading.textContent = COPY.fatalTitle;
    const body = document.createElement('p');
    body.textContent = detail;
    const hint = document.createElement('p');
    hint.textContent = COPY.fatalHint;
    const about = document.createElement('small');
    about.textContent = COPY.about;
    const retry = document.createElement('button');
    retry.className = 'fatal-retry';
    retry.type = 'button';
    retry.textContent = COPY.fatalRetry;
    retry.addEventListener('click', () => window.location.reload());
    panel.append(heading, body, hint, about, retry);
    root.append(panel);
  } catch {
    console.error('[boot] 致命错误且无法上屏：', detail);
  }
}

function start(): () => void {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('缺少 #app 挂载点');
  }

  // ── 1. 一次性读取环境与决策（此后全部只读） ──────────────────────────
  const params = parseParams(window.location.search);
  const capabilities = detectCapabilities(readBrowserEnv());
  const storage = resolveStorage();
  const decision = selectQuality(params, capabilities, readStoredQuality(storage));
  const profile = QUALITY_PROFILES[decision.tier];

  // ── 2. 基础设施 ───────────────────────────────────────────────────
  const logger = new Logger(params.debug ? 'debug' : 'info', 'boot');
  const events = new EventBus<AppEventMap>({
    onError: (error, type) => {
      logger.error('事件订阅异常', String(type), error);
    },
  });
  const rng = new Rng(params.seed);
  const ui = mountUi(root, {
    capabilities,
    events,
    quality: decision.tier,
    timeOfDay: params.tod,
    weather: params.weather,
    smoke: params.smoke,
  });
  let loop: Loop | null = null;
  const removeTrap = installFatalTrap((phase, error) => {
    logger.error('未处理错误', phase, error);
    const detail = `${phase}: ${error.message}`;
    markFatal(detail);
    ui.showFatal(COPY.fatalTitle, detail);
    events.emit('app:fatal', { error, phase });
    loop?.stop();
  });

  // ── 3. 无 WebGL 兜底：明确告知，不做静默降级 ────────────────────────
  if (capabilities.webgl === 'none') {
    ui.showFatal(COPY.fatalTitle, COPY.noWebgl);
    markFatal(COPY.noWebgl);
    events.emit('app:fatal', { error: new Error(COPY.noWebgl), phase: 'webgl-check' });
    return () => {
      removeTrap();
      ui.dispose();
    };
  }

  // ── 4. 渲染链路 ───────────────────────────────────────────────────
  const context = createSceneContext(ui.viewport, {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: capabilities.pixelRatio,
    profile,
  });
  const lightingRig = new LightingRig({
    scene: context.scene,
    renderer: context.rendering.renderer,
    profile,
    timeOfDay: TIME_OF_DAY_PRESETS[params.tod],
    weather: WEATHER_PRESETS[params.weather],
  });
  const skyDome = new SkyDome({
    scene: context.scene,
    timeOfDay: TIME_OF_DAY_PRESETS[params.tod],
    weather: WEATHER_PRESETS[params.weather],
  });
  const canvasFactory = (width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const world = createCourtyardWorld(context.scene, {
    canvasFactory,
    seed: rng.seed,
    anisotropy: profile.anisotropy,
    weather: WEATHER_PRESETS[params.weather],
    reducedMotion: capabilities.reducedMotion,
  });
  const input: InputSource =
    capabilities.touch && ui.touchMoveTarget !== null && ui.touchLookTarget !== null
      ? new TouchInput({
          moveTarget: ui.touchMoveTarget,
          lookTarget: ui.touchLookTarget,
          pointerTarget: window,
          moveRadiusPx: WORLD.touch.moveRadiusPx,
          lookSensitivityRadPerPixel: WORLD.touch.lookSensitivityRadPerPixel,
        })
      : new KeyboardMouseInput({
          keyboardTarget: window,
          pointerTarget: window,
          lookSensitivityRadPerPixel: WORLD.camera.lookSensitivityRadPerPixel,
        });
  const colliders = new StaticColliders({ obstacles: WORLD.collision.obstacles });
  const character = new Character({ parent: context.scene, colliders, events });
  const followCamera = new FollowCamera({ camera: context.camera, input });
  followCamera.snapTo(character.position);
  const ambientAudio = new AmbientAudio({
    eventTarget: window,
    events,
    contextFactory: createAudioContext,
    seed: rng.seed,
    weather: WEATHER_PRESETS[params.weather],
    weatherPresets: WEATHER_PRESETS,
    noAudio: params.noAudio,
  });
  const guideTriggers = new GuideTriggers({
    events,
    player: character,
    entries: Object.values(GUIDE_ENTRIES),
  });
  const clock = new Clock(RENDER.fixedStepMs, RENDER.maxFrameDeltaMs);
  const registry = createRegistry<unknown>();
  registry.register('world', world);
  registry.register('input', input);
  registry.register('colliders', colliders);
  registry.register('character', character);
  registry.register('followCamera', followCamera);
  registry.register('ambientAudio', ambientAudio);
  registry.register('guideTriggers', guideTriggers);
  registry.register('lighting', { lightingRig, skyDome });
  registry.freeze();

  const statusText = `画质 ${decision.tier} · ${decision.reason}${params.bench ? ' · 基准模式' : ''}`;
  ui.setStatus(statusText);
  // 普通站点与离线单文件不启用联机；开发或独立测试站仍须显式开启并匹配配置来源。
  const multiplayerEnabled = import.meta.env.DEV || import.meta.env.MODE === 'multiplayer';
  const multiplayerUrl = multiplayerEnabled
    ? courtyardMultiplayerUrl(
        window.location.search,
        window.location.origin,
        import.meta.env.COURTYARD_LAN_ORIGIN,
      )
    : null;
  let multiplayerStatus: CourtyardMultiplayerStatus | undefined;
  const remotePlayers = multiplayerUrl
    ? new CourtyardRemotePlayers(context.scene, character.root, capabilities.reducedMotion)
    : null;
  const multiplayer =
    multiplayerUrl && remotePlayers
      ? new CourtyardMultiplayerClient(
          multiplayerUrl,
          (status) => {
            multiplayerStatus = status;
            if (status !== 'online') remotePlayers.clear();
            ui.setStatus(`${statusText} · ${COURTYARD_MULTIPLAYER_COPY[status]}`);
          },
          (snapshot) => remotePlayers.apply(snapshot, performance.now()),
        )
      : null;

  loop = new Loop({
    clock,
    events,
    onStep: (deltaMs) => {
      followCamera.updateControls();
      // 握手完毕前保持在共用出生点，以免第一条位置被房间的速度预算拒绝。
      if (!multiplayerEnabled || multiplayerStatus !== 'connecting') {
        character.update(deltaMs, input, followCamera.yaw);
      }
      followCamera.updateFollow(deltaMs, character.position);
      ambientAudio.update(deltaMs);
      if (!capabilities.reducedMotion) {
        world.update(deltaMs);
      }
    },
    onRender: () => {
      if (multiplayerEnabled && multiplayerStatus === 'online') {
        const now = performance.now();
        multiplayer?.update(now, character.position, character.yaw);
        remotePlayers?.update(now);
      }
      context.render();
    },
  });
  const activeLoop = loop;

  // ── 5. 事件接线 ───────────────────────────────────────────────────
  let currentTimeOfDay = params.tod;
  let currentWeather = params.weather;
  const removeTimeRequest = events.on('tod:request', ({ to }) => {
    if (to === currentTimeOfDay) {
      return;
    }
    const from = currentTimeOfDay;
    currentTimeOfDay = to;
    lightingRig.applyTimeOfDay(TIME_OF_DAY_PRESETS[to]);
    skyDome.applyTimeOfDay(TIME_OF_DAY_PRESETS[to]);
    events.emit('tod:changed', { from, to });
  });
  const removeWeatherRequest = events.on('weather:request', ({ to }) => {
    if (to === currentWeather) {
      return;
    }
    const from = currentWeather;
    currentWeather = to;
    lightingRig.applyWeather(WEATHER_PRESETS[to]);
    skyDome.applyWeather(WEATHER_PRESETS[to]);
    world.applyWeather(WEATHER_PRESETS[to]);
    events.emit('weather:changed', { from, to });
  });
  const removeBoundsNotice = events.on('player:boundsExceeded', ({ x, z }) => {
    logger.debug('玩家触及庭院边界', x, z);
  });
  const onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    context.resize(width, height);
    events.emit('app:resize', { width, height });
  };
  window.addEventListener('resize', onResize);

  installDebugProbe(import.meta.env.DEV || params.debug, {
    events,
    rng,
    tod: params.tod,
    weather: params.weather,
    quality: decision.tier,
    scene: context.scene,
    camera: context.camera,
    character,
    audio: ambientAudio,
    world,
  });

  // ── 6. 用户可见提示 ───────────────────────────────────────────────
  if (capabilities.reducedMotion) {
    ui.showNotice(COPY.reducedMotion);
  } else if (decision.tier === 'low' && params.quality === null) {
    ui.showNotice(COPY.lowEnd);
  }

  activeLoop.start();
  events.emit('app:ready', { startedAt: Date.now() });
  logger.info('启动完成', {
    version: APP.version,
    quality: decision.tier,
    reason: decision.reason,
    seed: rng.seed,
    smoke: params.smoke,
  });

  // ── 7. 统一释放 ───────────────────────────────────────────────────
  const dispose = (): void => {
    activeLoop.stop();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', dispose);
    removeTrap();
    removeTimeRequest();
    removeWeatherRequest();
    removeBoundsNotice();
    multiplayer?.dispose();
    remotePlayers?.dispose();
    guideTriggers.dispose();
    ambientAudio.dispose();
    input.dispose();
    skyDome.dispose();
    lightingRig.dispose();
    context.dispose();
    ui.dispose();
    events.clear();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}

export function bootstrap(): () => void {
  try {
    if (new URLSearchParams(window.location.search).get('scene') !== 'courtyard') {
      return startPureLand();
    }
    return start();
  } catch (error) {
    const normalized = toError(error);
    console.error('[boot] 启动失败', normalized);
    showFallbackFatal(normalized.message);
    return noop;
  }
}
