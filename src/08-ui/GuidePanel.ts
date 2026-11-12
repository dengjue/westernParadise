import type { AppEventMap, EventBusLike, GuideId } from '@/00-types';

export interface GuidePanelOptions {
  readonly parent: HTMLElement;
  readonly events: EventBusLike<AppEventMap>;
  readonly reducedMotion: boolean;
}

export interface GuidePanelHandle {
  readonly root: HTMLElement;
  dispose(): void;
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/**
 * 建筑说明面板。
 *
 * 面板只消费 GuideTriggers 已经解析好的标题和正文，不反查配置；所有文本通过
 * textContent 写入，既保持事件契约单向，也避免将来文案变更时引入 HTML 注入面。
 */
export function mountGuidePanel(options: GuidePanelOptions): GuidePanelHandle {
  const panel = element('section', 'hud-guide-panel');
  const title = element('h2', 'hud-guide-title');
  const body = element('p', 'hud-guide-body');
  panel.append(title, body);
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-hidden', 'true');
  panel.dataset.reducedMotion = String(options.reducedMotion);
  options.parent.append(panel);

  let activeId: GuideId | null = null;
  let showFrame: number | null = null;

  const onGuideShow = ({
    id,
    title: nextTitle,
    body: nextBody,
  }: AppEventMap['guide:show']): void => {
    activeId = id;
    title.textContent = nextTitle;
    body.textContent = nextBody;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    if (options.reducedMotion) {
      panel.classList.add('is-visible');
      return;
    }
    if (showFrame !== null) {
      cancelAnimationFrame(showFrame);
    }
    showFrame = requestAnimationFrame(() => {
      showFrame = null;
      if (activeId === id) {
        panel.classList.add('is-visible');
      }
    });
  };

  const onGuideHide = ({ id }: AppEventMap['guide:hide']): void => {
    if (activeId !== id) {
      return;
    }
    activeId = null;
    if (showFrame !== null) {
      cancelAnimationFrame(showFrame);
      showFrame = null;
    }
    panel.classList.remove('is-visible');
    panel.setAttribute('aria-hidden', 'true');
    if (options.reducedMotion) {
      panel.hidden = true;
    }
  };

  const offGuideShow = options.events.on('guide:show', onGuideShow);
  const offGuideHide = options.events.on('guide:hide', onGuideHide);

  return {
    root: panel,
    dispose() {
      offGuideShow();
      offGuideHide();
      if (showFrame !== null) {
        cancelAnimationFrame(showFrame);
        showFrame = null;
      }
      panel.remove();
    },
  };
}
