import type { AppEventMap } from '@/00-types';
import {
  APP,
  COPY,
  DEFAULT_TIME_OF_DAY_ID,
  DEFAULT_WEATHER_ID,
  QUALITY_PROFILES,
  RENDER,
  TIME_OF_DAY_PRESETS,
  WEATHER_PRESETS,
} from '@/01-shared';
import { Clock, EventBus, Logger, Rng, toError } from '@/02-core';
import {
  detectCapabilities,
  parseParams,
  readBrowserEnv,
  readStoredQuality,
  resolveStorage,
  selectQuality,
  writeStoredQuality,
} from '@/03-platform';
import { createSceneContext, Loop } from '@/04-engine';
import { createPlaceholderWorld, LightingRig, SkyDome } from '@/06-world';
import { mountUi } from '@/08-ui';
import { installDebugProbe, installFatalTrap, markFatal } from '@/98-diagnostics';

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
    panel.append(heading, body, hint, about);
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
  writeStoredQuality(storage, decision.tier);

  // ── 2. 基础设施 ───────────────────────────────────────────────────
  const logger = new Logger(params.debug ? 'debug' : 'info', 'boot');
  const events = new EventBus<AppEventMap>({
    onError: (error, type) => {
      logger.error('事件订阅异常', String(type), error);
    },
  });
  const ui = mountUi(root, { capabilities, smoke: params.smoke });

  // ── 3. 无 WebGL 兜底：明确告知，不做静默降级 ────────────────────────
  if (capabilities.webgl === 'none') {
    ui.showFatal(COPY.fatalTitle, COPY.noWebgl);
    markFatal(COPY.noWebgl);
    events.emit('app:fatal', { error: new Error(COPY.noWebgl), phase: 'webgl-check' });
    return () => {
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
    timeOfDay: TIME_OF_DAY_PRESETS[DEFAULT_TIME_OF_DAY_ID],
    weather: WEATHER_PRESETS[DEFAULT_WEATHER_ID],
  });
  const skyDome = new SkyDome({
    scene: context.scene,
    timeOfDay: TIME_OF_DAY_PRESETS[DEFAULT_TIME_OF_DAY_ID],
    weather: WEATHER_PRESETS[DEFAULT_WEATHER_ID],
  });
  // 占位场景只用于验证链路；M1 落地真实庭院时整体替换此调用。
  const world = createPlaceholderWorld(context.scene);
  const clock = new Clock(RENDER.fixedStepMs, RENDER.maxFrameDeltaMs);
  const rng = new Rng(params.seed);

  const loop = new Loop({
    clock,
    events,
    onStep: capabilities.reducedMotion ? noop : (deltaMs) => world.update(deltaMs),
    onRender: () => context.render(),
  });

  // ── 5. 事件接线 ───────────────────────────────────────────────────
  const onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    context.resize(width, height);
    events.emit('app:resize', { width, height });
  };
  window.addEventListener('resize', onResize);

  const removeTrap = installFatalTrap((phase, error) => {
    logger.error('未处理错误', phase, error);
    const detail = `${phase}: ${error.message}`;
    markFatal(detail);
    ui.showFatal(COPY.fatalTitle, detail);
    events.emit('app:fatal', { error, phase });
    loop.stop();
  });

  installDebugProbe(params.debug || params.smoke || params.bench, {
    version: APP.version,
    quality: decision.tier,
    seed: rng.seed,
    capabilities,
    events,
    clock,
    loop,
  });

  // ── 6. 用户可见提示 ───────────────────────────────────────────────
  ui.setStatus(`画质 ${decision.tier} · ${decision.reason}${params.bench ? ' · 基准模式' : ''}`);
  if (capabilities.reducedMotion) {
    ui.showNotice(COPY.reducedMotion);
  } else if (decision.tier === 'low' && params.quality === null) {
    ui.showNotice(COPY.lowEnd);
  }

  loop.start();
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
    loop.stop();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', dispose);
    removeTrap();
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
    return start();
  } catch (error) {
    const normalized = toError(error);
    console.error('[boot] 启动失败', normalized);
    showFallbackFatal(normalized.message);
    return noop;
  }
}
