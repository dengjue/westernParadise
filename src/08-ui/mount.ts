import type { Capabilities } from '@/00-types';
import { APP, COPY } from '@/01-shared';

/**
 * DOM HUD 挂载。
 *
 * 只用 createElement + textContent，绝不拼 innerHTML：
 * 文案将来会来自配置/导览数据，innerHTML 拼接等于给自己留 XSS 入口。
 * 本层允许碰 document，是 03-platform 之外少数被许可触碰浏览器 DOM 的层。
 */

export interface UiOptions {
  readonly capabilities: Capabilities;
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
  const { capabilities, smoke } = options;
  document.documentElement.classList.toggle('is-touch', capabilities.touch);
  document.documentElement.classList.toggle('is-reduced', capabilities.reducedMotion);

  const viewport = element('div', 'viewport');
  const hud = element('div', 'hud');
  const status = element('div', 'hud-status', COPY.loading);
  const badge = element('div', 'hud-badge', APP.name);
  const notice = element('div', 'hud-notice');
  notice.hidden = true;

  hud.append(badge, status, notice);
  root.append(viewport, hud);

  if (smoke) {
    const smokeBadge = element('div', 'hud-badge', COPY.smokeBadge);
    smokeBadge.style.top = `calc(40px + var(--sat))`;
    hud.append(smokeBadge);
  }

  let fatalPanel: HTMLElement | null = null;

  return {
    viewport,
    setStatus(text) {
      status.textContent = text;
    },
    showNotice(text) {
      notice.textContent = text;
      notice.hidden = false;
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
      viewport.remove();
      hud.remove();
      fatalPanel?.remove();
      document.documentElement.classList.remove('is-touch', 'is-reduced');
    },
  };
}
