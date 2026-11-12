import type {
  AppEventMap,
  Capabilities,
  EventBusLike,
  QualityTier,
  TimeOfDayId,
  WeatherId,
} from '@/00-types';
import { COPY } from '@/01-shared';
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

export function mountUi(root: HTMLElement, options: UiOptions): UiHandle {
  const { capabilities } = options;
  document.documentElement.classList.toggle('is-touch', capabilities.touch);
  document.documentElement.classList.toggle('is-reduced', capabilities.reducedMotion);

  const viewport = element('div', 'viewport');
  root.append(viewport);
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
    },
    dispose() {
      guidePanel.dispose();
      hud.dispose();
      viewport.remove();
      fatalPanel?.remove();
      document.documentElement.classList.remove('is-touch', 'is-reduced');
    },
  };
}
