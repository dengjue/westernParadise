import type { AppEventMap } from '@/00-types';
import {
  COPY,
  companionColor,
  LAND_JOURNEY,
  LAND_RENDER,
  LAND_SOUND,
  LAND_WORLD,
  PURE_LAND,
  QUALITY_PROFILES,
  WEATHER_PRESETS,
} from '@/01-shared';
import { AdaptiveRenderBudget, Clock, EventBus } from '@/02-core';
import {
  AmbientAudio,
  CourtyardMultiplayerClient,
  courtyardMultiplayerUrl,
  detectCapabilities,
  parseParams,
  readBrowserEnv,
  readStoredQuality,
  resolveStorage,
  selectQuality,
  writeStoredQuality,
} from '@/03-platform';
import {
  createCinematicPipeline,
  createSceneContext,
  FrameBudgetDriver,
  Loop,
  RenderTelemetry,
} from '@/04-engine';
import type { FrameBudgetSlowStep, FrameBudgetStats } from '@/04-engine';
import {
  createPureLandWorld,
  createPureLandWorldSteps,
  LandPmremAtlasGate,
  loadLandPmremAtlas,
} from '@/06-world';
import type { PureLandWorldOptions } from '@/06-world';
import {
  CourtyardRemotePlayers,
  KeyboardMouseInput,
  LandAvatar,
  LandCamera,
  TouchInput,
} from '@/07-systems';
import { mountLandFrameCheck, mountPureLandUi } from '@/08-ui';
import {
  installDebugProbe,
  installFatalTrap,
  markFatal,
  mountLandCrowdCheck,
} from '@/98-diagnostics';

/** 主线程让出切片，不是目标设备/A4 的性能预算或帧时保证。 */
const THIRD_PERSON_BUILD_BUDGET_MS = 6;

interface StartupStats {
  syncMs: number;
  firstFrameMs: number;
  assetDecodeMs: number;
  assetDecodeFrames: number;
  assetDecodeBytes: number;
  buildMs: number;
  buildFrames: number;
  buildSteps: number;
  maxBuildStepMs: number;
  maxBuildStepStage: string;
  slowestBuildSteps: FrameBudgetSlowStep[];
  buildOverBudgetSteps: number;
}

type PureLandWorld = ReturnType<typeof createPureLandWorld>;
type RuntimeParams = ReturnType<typeof parseParams>;
type RuntimeCapabilities = ReturnType<typeof detectCapabilities>;
type RuntimeDecision = ReturnType<typeof selectQuality>;
type PureLandUi = ReturnType<typeof mountPureLandUi>;
type PureLandContext = ReturnType<typeof createSceneContext>;

interface PureLandRuntimeOptions {
  start: number;
  startup: StartupStats;
  params: RuntimeParams;
  capabilities: RuntimeCapabilities;
  decision: RuntimeDecision;
  adaptive: AdaptiveRenderBudget;
  events: EventBus<AppEventMap>;
  ui: PureLandUi;
  context: PureLandContext;
  world: PureLandWorld;
  initialTime: RuntimeParams['tod'];
}

function releaseAll(dispose: readonly (() => void)[]): void {
  let firstError: unknown;
  let failed = false;
  for (const release of dispose) {
    try {
      release();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

/** 新世界独立装配，历史庭院仍可通过 scene=courtyard 复现。 */
export function startPureLand(): () => void {
  const start = performance.now();
  const startup: StartupStats = {
    syncMs: 0,
    firstFrameMs: 0,
    assetDecodeMs: 0,
    assetDecodeFrames: 0,
    assetDecodeBytes: 0,
    buildMs: 0,
    buildFrames: 0,
    buildSteps: 0,
    maxBuildStepMs: 0,
    maxBuildStepStage: '',
    slowestBuildSteps: [],
    buildOverBudgetSteps: 0,
  };
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
  const initialTime = raw.has('tod') ? params.tod : ('dawn' as const);
  const atlasGate = params.cam === 'third' ? new LandPmremAtlasGate() : undefined;
  const events = new EventBus<AppEventMap>();
  const thirdPerson = params.cam === 'third';
  const ui = mountPureLandUi(root, {
    events,
    capabilities,
    quality: decision.tier,
    time: initialTime,
    noAudio: params.noAudio,
    thirdPerson,
  });
  document.title = '西方极乐世界 · 数字园境共创';
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
  const worldOptions: PureLandWorldOptions = {
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
    time: initialTime,
    reducedMotion: capabilities.reducedMotion,
    regionPrototype: thirdPerson,
    ...(atlasGate ? { prebakedEnvironmentGate: atlasGate } : {}),
    cellOrigin: thirdPerson ? [LAND_WORLD.cellOrigin.x, LAND_WORLD.cellOrigin.z] : undefined,
    cellSize:
      (params.bench || params.debug) && raw.get('chunk') === '24'
        ? LAND_RENDER.cellCandidates[0]
        : LAND_RENDER.cellSize,
  };

  if (!thirdPerson) {
    const world = createPureLandWorld(context.scene, worldOptions);
    return startPureLandRuntime({
      start,
      startup,
      params,
      capabilities,
      decision,
      adaptive,
      events,
      ui,
      context,
      world,
      initialTime,
    });
  }

  startup.syncMs = performance.now() - start;
  const loadingText =
    import.meta.env.MODE === 'multiplayer' && raw.get('crowdcheck') === '1'
      ? '单机模拟 · 正在准备场景，加载完成后自动开始'
      : undefined;
  ui.setLoading(true, loadingText);
  const buildProgress = {
    stage: 'waiting',
    detailed: import.meta.env.DEV || params.debug || params.bench,
  };
  const assetAbort = new AbortController();
  let driver: FrameBudgetDriver<PureLandWorld> | undefined;
  let runtimeDispose: (() => void) | undefined;
  let completedWorld: PureLandWorld | undefined;
  let disposed = false;
  let contextDisposed = false;
  let listenersRemoved = false;
  let contextLost = false;

  const removeLoadingListeners = (): void => {
    if (listenersRemoved) return;
    listenersRemoved = true;
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    document.removeEventListener('visibilitychange', visibility);
    context.canvas.removeEventListener('webglcontextlost', onContextLost);
    context.canvas.removeEventListener('webglcontextrestored', onContextRestored);
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (runtimeDispose) {
      releaseAll([
        () => assetAbort.abort(),
        () => driver?.cancel(),
        () => atlasGate?.dispose(),
        removeLoadingListeners,
        runtimeDispose,
      ]);
      return;
    }
    releaseAll([
      () => assetAbort.abort(),
      () => driver?.cancel(),
      () => atlasGate?.dispose(),
      removeLoadingListeners,
      () => {
        try {
          completedWorld?.dispose();
        } finally {
          completedWorld = undefined;
        }
      },
      () => {
        if (contextDisposed) return;
        try {
          context.dispose();
        } finally {
          contextDisposed = true;
        }
      },
      () => ui.dispose(),
      () => events.clear(),
    ]);
  }

  const fail = (error: unknown): void => {
    if (disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    markFatal(message);
    ui.setLoading(true, '场景准备失败，请刷新页面重试');
    try {
      releaseAll([
        () => assetAbort.abort(),
        () => driver?.cancel(),
        () => atlasGate?.dispose(),
        () => {
          try {
            completedWorld?.dispose();
          } finally {
            completedWorld = undefined;
          }
        },
        () => {
          if (contextDisposed) return;
          try {
            context.dispose();
          } finally {
            contextDisposed = true;
          }
        },
        removeLoadingListeners,
      ]);
    } catch (cleanupError) {
      console.error('第三人称场景清理失败', cleanupError);
    }
  };

  const onContextLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
    driver?.pause();
    ui.setLoading(true, '画面连接中断，正在等待浏览器恢复');
    ui.showNotice('画面连接暂时中断，正在等待浏览器恢复。');
  };
  const onContextRestored = (): void => {
    contextLost = false;
    ui.setLoading(true, loadingText);
    if (!document.hidden) driver?.resume();
  };
  function pageHide(event: PageTransitionEvent): void {
    if (!event.persisted) {
      dispose();
      return;
    }
    driver?.pause();
  }
  function pageShow(): void {
    if (!document.hidden && !contextLost) driver?.resume();
  }
  const visibility = (): void => {
    if (document.hidden) driver?.pause();
    else if (!contextLost) driver?.resume();
  };

  const beginBuild = (): void => {
    if (disposed) {
      atlasGate?.dispose();
      return;
    }
    const steps = createPureLandWorldSteps(context.scene, worldOptions, buildProgress);
    try {
      driver = new FrameBudgetDriver({
        iterator: steps,
        budgetMs: THIRD_PERSON_BUILD_BUDGET_MS,
        deferFirstFrame: true,
        getStepLabel: () => buildProgress.stage,
        onYield() {
          if (buildProgress.stage === 'environment:waiting-atlas' && atlasGate?.pending)
            driver?.pause();
        },
        slowStepLimit: import.meta.env.DEV || params.debug || params.bench ? 12 : 0,
        onComplete(world, stats) {
          if (disposed) {
            world.dispose();
            return;
          }
          completedWorld = world;
          recordBuildStats(startup, stats);
          removeLoadingListeners();
          ui.setLoading(false);
          try {
            runtimeDispose = startPureLandRuntime({
              start,
              startup,
              params,
              capabilities,
              decision,
              adaptive,
              events,
              ui,
              context,
              world,
              initialTime,
            });
            completedWorld = undefined;
          } catch (error) {
            fail(error);
          }
        },
        onError(error, stats) {
          recordBuildStats(startup, stats);
          fail(error);
        },
      });
    } catch (error) {
      steps.return?.(undefined as unknown as PureLandWorld);
      atlasGate?.dispose();
      throw error;
    }
    if (document.hidden || contextLost) driver.pause();
    driver.start();
  };

  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  document.addEventListener('visibilitychange', visibility);
  context.canvas.addEventListener('webglcontextlost', onContextLost);
  context.canvas.addEventListener('webglcontextrestored', onContextRestored);
  void loadLandPmremAtlas(assetAbort.signal)
    .then((environment) => {
      if (disposed || assetAbort.signal.aborted) {
        environment.dispose();
        return;
      }
      startup.assetDecodeMs = environment.stats.decodeMs;
      startup.assetDecodeFrames = environment.stats.yieldedFrames;
      startup.assetDecodeBytes = environment.stats.compressedBytes;
      atlasGate?.resolve(environment);
      if (!document.hidden && !contextLost) driver?.resume();
    })
    .catch((error: unknown) => {
      atlasGate?.reject(error);
      if (disposed || assetAbort.signal.aborted) return;
      fail(error);
    });
  try {
    beginBuild();
  } catch (error) {
    fail(error);
  }
  return dispose;
}

function recordBuildStats(startup: StartupStats, stats: Readonly<FrameBudgetStats>): void {
  startup.buildMs = stats.elapsedMs;
  startup.buildFrames = stats.frames;
  startup.buildSteps = stats.steps;
  startup.maxBuildStepMs = stats.maxStepMs;
  startup.maxBuildStepStage = stats.maxStepLabel;
  startup.slowestBuildSteps = stats.slowestSteps;
  startup.buildOverBudgetSteps = stats.overBudgetSteps;
}

function startPureLandRuntime(options: PureLandRuntimeOptions): () => void {
  const {
    start,
    startup,
    params,
    capabilities,
    decision,
    adaptive: adaptiveBudget,
    events,
    ui,
    context,
    world,
  } = options;
  let time = options.initialTime;
  const renderer = context.rendering.renderer;
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
    if (adaptiveBudget.update(frame.deltaMs)) {
      renderer.setPixelRatio(basePixelRatio * adaptiveBudget.scale);
      pipeline.setScale(adaptiveBudget.scale);
      world.reflection.setScale(adaptiveBudget.scale);
    }
  });
  const input = capabilities.touch
    ? new TouchInput({
        moveTarget: ui.move,
        lookTarget: ui.look,
        pointerTarget: window,
        moveRadiusPx: LAND_JOURNEY.moveRadiusPx,
        lookSensitivityRadPerPixel: LAND_JOURNEY.touchSensitivity,
        ascendTarget: ui.ascend,
        descendTarget: ui.descend,
        feedback: ui.touchFeedback,
      })
    : new KeyboardMouseInput({
        keyboardTarget: window,
        pointerTarget: window,
        lookSensitivityRadPerPixel: LAND_JOURNEY.mouseSensitivity,
        flightControlsEnabled: params.cam === 'third',
      });
  // 默认第一人称与四景点观览不装配 avatar；第三人称原型才启用角色和遮挡回拉。
  const avatar = params.cam === 'third' ? new LandAvatar(context.scene) : undefined;
  const crowdMode =
    import.meta.env.MODE === 'multiplayer' &&
    avatar !== undefined &&
    new URLSearchParams(location.search).get('crowdcheck') === '1';
  const endpoint =
    !crowdMode && avatar && (import.meta.env.DEV || import.meta.env.MODE === 'multiplayer')
      ? courtyardMultiplayerUrl(
          location.search,
          location.origin,
          import.meta.env.COURTYARD_LAN_ORIGIN,
        )
      : null;
  const remotes =
    (endpoint || crowdMode) && avatar
      ? new CourtyardRemotePlayers(
          context.scene,
          avatar.root,
          capabilities.reducedMotion,
          Boolean(endpoint),
        )
      : null;
  const camera = new LandCamera({
    camera: context.camera,
    input,
    events,
    reducedMotion: capabilities.reducedMotion,
    avatar,
    sharedEntrance: crowdMode || Boolean(endpoint),
    allowsGroundStep: endpoint ? remotes?.allowsGroundStep : undefined,
    occluder: avatar ? context.scene : undefined,
  });
  const crowdCheck =
    crowdMode && remotes
      ? mountLandCrowdCheck(ui.viewport, remotes, context.camera, decision.tier)
      : null;
  let peer: CourtyardMultiplayerClient | undefined;
  let joining = false;
  let online = false;
  const roomHud = endpoint ? ui.mountRoomStatus() : null;
  let identity = '';
  const showNeighbors = () => roomHud?.set(`已联机 · ${identity}附近 ${remotes?.count ?? 0} 人`);
  const frameCheck =
    endpoint && new URLSearchParams(location.search).get('framecheck') === '1'
      ? mountLandFrameCheck(ui.viewport, decision.tier)
      : null;
  const leaveRoom = () => {
    peer?.dispose();
    peer = undefined;
    joining = false;
    online = false;
    roomHud?.set('');
    if (identity) avatar?.setRoomColor();
    identity = '';
    frameCheck?.reset();
    remotes?.clear();
  };
  const offRoom =
    endpoint && avatar && remotes
      ? events.on('land:state', ({ walking, flying }) => {
          if (!walking && !flying) {
            leaveRoom();
            return;
          }
          // 降落在其他地点时不从异地冒充出生点；重新进入游历即可加入。
          const [x, z] = LAND_JOURNEY.entries[0];
          if (peer || avatar.root.position.x !== x || avatar.root.position.z !== z) return;
          peer = new CourtyardMultiplayerClient(
            `${endpoint}?world=land`,
            (status) => {
              joining = status === 'connecting';
              online = status === 'online';
              if (!online) frameCheck?.reset();
              if (status !== 'online') remotes.clear();
              const text = {
                connecting: '正在加入大世界联机…',
                online: '已加入大世界联机',
                offline: '联机已断开，继续独自游历',
                'room-full': '房间已满，继续独自游历',
              };
              if (online) showNeighbors();
              else {
                roomHud?.set(text[status]);
                avatar.setRoomColor();
                identity = '';
              }
              ui.showNotice(text[status], true);
            },
            (snapshot) => {
              const before = remotes.count;
              remotes.apply(snapshot, performance.now());
              if (before !== remotes.count) showNeighbors();
            },
            true,
            (spawn, id) => {
              camera.placeAtRoomEntrance(spawn);
              avatar.setRoomColor(id);
              identity = `${companionColor(id).name} #${id} · `;
            },
          );
        })
      : undefined;
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
      if (crowdCheck) {
        if (!camera.isWalking && !camera.isFlying) camera.startWalking(true);
      } else if (!joining) camera.update(delta);
      world.update(delta, camera.cellCameraPose);
      audioElapsed += delta;
      if (audioElapsed >= LAND_SOUND.updateMs) {
        audioElapsed %= LAND_SOUND.updateMs;
        Object.assign(audioPosition, context.camera.position);
        events.emit('audio:position', audioPosition);
      }
      audio.update(delta);
    },
    onRender: () => {
      crowdCheck?.prepare(performance.now());
      if (peer && avatar && remotes) {
        const now = performance.now();
        peer.update(now, avatar.root.position, avatar.yaw, camera.isFlying);
        remotes.update(now);
      }
      renderer.info.reset();
      world.reflection.beginFrame(elapsedMs);
      telemetry.begin(performance.now());
      try {
        pipeline.render();
        if (crowdCheck && camera.isWalking && !modal) {
          crowdCheck.frame(performance.now(), context.canvas.width, context.canvas.height);
        }
        if (frameCheck && online && remotes && !modal) {
          frameCheck.frame(
            performance.now(),
            remotes.count,
            camera.isFlying,
            context.canvas.width,
            context.canvas.height,
          );
        }
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
    if (suspended || modal) crowdCheck?.reset();
    if (suspended || modal) frameCheck?.reset();
    input.setEnabled(!crowdMode && !modal && !suspended);
    events.emit('land:suspend', { suspended });
    if (suspended) loop.stop();
    else loop.start();
  }
  const visibility = (): void => syncActivity();
  const pageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) {
      dispose();
      return;
    }
    input.setEnabled(false);
    crowdCheck?.reset();
    frameCheck?.reset();
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
    ui.showNotice('画面连接暂时中断，正在等待浏览器恢复；若长时间未恢复，请刷新页面。');
  };
  const contextRestored = (): void => {
    lost = false;
    syncActivity();
    ui.showNotice('画面连接已恢复。', true);
  };
  context.canvas.addEventListener('webglcontextlost', contextLost);
  context.canvas.addEventListener('webglcontextrestored', contextRestored);
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
    renderBudget: {
      adaptive: adaptiveBudget,
      pipeline: pipeline.stats,
      telemetry: telemetry.stats,
    },
    startup,
    dispose,
    restart: () => {
      dispose();
      return startPureLand();
    },
  });
  if (params.cam !== 'third') startup.syncMs = performance.now() - start;
  syncActivity();
  events.emit('app:ready', { startedAt: Date.now() });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    releaseAll([
      () => loop.stop(),
      () => offRoom?.(),
      leaveRoom,
      () => roomHud?.dispose(),
      () => crowdCheck?.dispose(),
      () => frameCheck?.dispose(),
      () => remotes?.dispose(),
      removeTime,
      removeBudget,
      removeTrap,
      removeModal,
      () => window.removeEventListener('resize', resize),
      () => window.removeEventListener('pagehide', pageHide),
      () => document.removeEventListener('visibilitychange', visibility),
      () => window.removeEventListener('blur', visibility),
      () => window.removeEventListener('focus', visibility),
      () => window.removeEventListener('pageshow', visibility),
      () => context.canvas.removeEventListener('webglcontextlost', contextLost),
      () => context.canvas.removeEventListener('webglcontextrestored', contextRestored),
      () => input.dispose(),
      () => camera.dispose(),
      () => audio.dispose(),
      () => world.dispose(),
      () => pipeline.dispose(),
      () => telemetry.dispose(),
      () => context.dispose(),
      () => ui.dispose(),
      () => events.clear(),
    ]);
  }
  window.addEventListener('pagehide', pageHide);
  return dispose;
}
