import type {
  AppEventMap,
  Capabilities,
  EventBusLike,
  QualityTier,
  TimeOfDayId,
  WeatherId,
} from '@/00-types';
import { COPY, WORLD } from '@/01-shared';
import { mountGuidePanel } from './GuidePanel';
import { mountHud } from './Hud';

/**
 * DOM HUD 挂载。
 *
 * 只用 createElement + textContent，绝不拼 innerHTML：
 * 文案将来会来自配置/导览数据，innerHTML 拼接等于给自己留 XSS 入口。
 * 本层允许碰 document，是 03-platform 之外少数被许可触碰浏览器 DOM 的层。
 */

export interface UiOptions {
  readonly capabilities: Capabilities;
  readonly events: EventBusLike<AppEventMap>;
  readonly quality: QualityTier;
  readonly timeOfDay: TimeOfDayId;
  readonly weather: WeatherId;
  readonly smoke: boolean;
}

export interface UiHandle {
  /** 3D canvas 的挂载容器。 */
  readonly viewport: HTMLElement;
  /** 触控移动与视角输入面板；非触屏环境为 null。 */
  readonly touchMoveTarget: HTMLElement | null;
  readonly touchLookTarget: HTMLElement | null;
  setStatus(text: string): void;
  showNotice(text: string): void;
  showFatal(title: string, detail: string): void;
  dispose(): void;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

interface TouchControlsHandle {
  readonly root: HTMLElement;
  readonly move: HTMLElement;
  readonly look: HTMLElement;
}

function mountTouchControls(parent: HTMLElement): TouchControlsHandle {
  const controls = element('div', 'touch-controls');
  controls.style.setProperty('--touch-pad-size', `${WORLD.touch.padSizePx}px`);
  controls.style.setProperty('--touch-pad-edge', `${WORLD.touch.edgeInsetPx}px`);
  controls.setAttribute('aria-label', '触控操作区');

  const move = element('div', 'touch-pad touch-pad-move');
  move.setAttribute('aria-label', '触控移动区');
  move.setAttribute('role', 'application');
  move.append(element('span', 'touch-pad-thumb'));

  const look = element('div', 'touch-pad touch-pad-look');
  look.setAttribute('aria-label', '触控视角区');
  look.setAttribute('role', 'application');
  look.append(element('span', 'touch-pad-thumb'));

  controls.append(move, look);
  parent.append(controls);
  return { root: controls, move, look };
}

export function mountUi(root: HTMLElement, options: UiOptions): UiHandle {
  const { capabilities } = options;
  document.documentElement.classList.toggle('is-touch', capabilities.touch);
  document.documentElement.classList.toggle('is-reduced', capabilities.reducedMotion);

  const viewport = element('div', 'viewport');
  root.append(viewport);
  const touchControls = capabilities.touch ? mountTouchControls(root) : null;
  const hud = mountHud({
    parent: root,
    events: options.events,
    quality: options.quality,
    timeOfDay: options.timeOfDay,
    weather: options.weather,
    smoke: options.smoke,
  });
  const guidePanel = mountGuidePanel({
    parent: root,
    events: options.events,
    reducedMotion: capabilities.reducedMotion,
  });

  let fatalPanel: HTMLElement | null = null;

  return {
    viewport,
    touchMoveTarget: touchControls?.move ?? null,
    touchLookTarget: touchControls?.look ?? null,
    setStatus(text) {
      hud.setStatus(text);
    },
    showNotice(text) {
      hud.showNotice(text);
    },
    showFatal(title, detail) {
      if (fatalPanel) {
        return;
      }
      fatalPanel = element('div', 'fatal');
      const heading = element('h1', 'fatal-title', title);
      const body = element('p', 'fatal-detail', detail);
      const hint = element('p', 'fatal-hint', COPY.fatalHint);
      const about = element('small', 'fatal-about', COPY.about);
      const retry = document.createElement('button');
      retry.className = 'fatal-retry';
      retry.type = 'button';
      retry.textContent = COPY.fatalRetry;
      retry.addEventListener('click', () => window.location.reload());
      fatalPanel.append(heading, body, hint, about, retry);
      root.append(fatalPanel);
      viewport.hidden = true;
      if (touchControls) {
        touchControls.root.hidden = true;
      }
    },
    dispose() {
      guidePanel.dispose();
      hud.dispose();
      touchControls?.root.remove();
      viewport.remove();
      fatalPanel?.remove();
      document.documentElement.classList.remove('is-touch', 'is-reduced');
    },
  };
}
