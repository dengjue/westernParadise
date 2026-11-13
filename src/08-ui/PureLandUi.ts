import type { AppEventMap, Capabilities, EventBusLike, QualityTier, TimeOfDayId } from '@/00-types';
import { LAND_LIGHT, LAND_QUALITY, PURE_LAND } from '@/01-shared';

interface LandUiOptions {
  events: EventBusLike<AppEventMap>;
  capabilities: Capabilities;
  quality: QualityTier;
  time: TimeOfDayId;
  noAudio: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, label = text): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  return node;
}

function lotusMark(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  const paths = [
    'M24 37C9 26 15 14 24 6c9 8 15 20 0 31Z',
    'M24 37C9 38 5 28 5 18c11 1 17 7 19 19Z',
    'M24 37c15 1 19-9 19-19-11 1-17 7-19 19Z',
    'M9 41h30',
  ];
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.25');
    svg.append(path);
  }
  return svg;
}

export function mountPureLandUi(root: HTMLElement, options: LandUiOptions) {
  const { events, capabilities } = options;
  let currentTime = options.time;
  const removes: (() => void)[] = [];
  root.classList.add('land-app');
  const viewport = el('div', 'viewport land-viewport');
  root.append(viewport);
  const overlay = el('main', 'land-ui');
  const header = el('header', 'land-header');
  const brand = button('land-brand', '', '返回极乐全境');
  brand.append(
    lotusMark(),
    el('span', 'land-brand-name', '极乐世界'),
    el('span', 'land-brand-en', 'PURE LAND'),
  );
  brand.addEventListener('click', () => events.emit('land:view', { index: 0 }));
  const navigation = el('nav', 'land-navigation');
  navigation.setAttribute('aria-label', '观景点');
  const viewButtons = PURE_LAND.views.map((view, index) => {
    const node = button('land-nav-button', view.title);
    node.addEventListener('click', () => events.emit('land:view', { index }));
    navigation.append(node);
    return node;
  });
  const headerTools = el('div', 'land-header-tools');
  const sourceButton = button('land-text-button', PURE_LAND.copy.sources);
  const audioButton = button('land-icon-button land-audio', '♫', '开启环境音');
  audioButton.setAttribute('aria-pressed', 'false');
  let audioEnabled = false;
  audioButton.disabled = options.noAudio;
  if (options.noAudio) audioButton.title = '当前链接已禁用音频';
  audioButton.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    audioButton.setAttribute('aria-pressed', String(audioEnabled));
    audioButton.setAttribute('aria-label', audioEnabled ? '关闭环境音' : '开启环境音');
    events.emit('audio:request', { enabled: audioEnabled });
  });
  headerTools.append(sourceButton, audioButton);
  header.append(brand, navigation, headerTools);

  const title = el('section', 'land-title');
  const titleEyebrow = el('div', 'land-eyebrow', '西 方 净 土 · 数 字 造 境');
  const heading = el('h1', 'land-heading');
  heading.append(el('span', '', '西方'), el('span', '', '极乐'));
  const titleEn = el('div', 'land-title-en', PURE_LAND.english);
  const line = el('div', 'land-title-rule');
  const subtitle = el('p', 'land-subtitle', PURE_LAND.subtitle);
  const enter = button('land-enter', PURE_LAND.copy.enter + '　↗');
  enter.addEventListener('click', () => events.emit('land:walk', {}));
  title.append(titleEyebrow, heading, titleEn, line, subtitle, enter);

  const settings = el('aside', 'land-settings');
  settings.setAttribute('aria-label', '场景设置');
  const timeLabel = el('div', 'land-setting-label', '光 阴');
  const timeGroup = el('div', 'land-time-group');
  const timeButtons = (Object.keys(LAND_LIGHT) as TimeOfDayId[]).map((id) => {
    const node = button('land-time-button', LAND_LIGHT[id].label);
    node.setAttribute('aria-pressed', String(id === options.time));
    node.addEventListener('click', () => events.emit('tod:request', { to: id }));
    timeGroup.append(node);
    return { id, node };
  });
  const qualityLabel = el('label', 'land-quality-label');
  qualityLabel.append(el('span', '', '画质'));
  const quality = el('select', 'land-quality');
  quality.setAttribute('aria-label', '画质');
  for (const tier of Object.keys(LAND_QUALITY) as QualityTier[]) {
    const option = el('option', '', LAND_QUALITY[tier]);
    option.value = tier;
    option.selected = tier === options.quality;
    quality.append(option);
  }
  quality.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('q', quality.value);
    url.searchParams.set('tod', currentTime);
    window.location.href = url.href;
  });
  qualityLabel.append(quality);
  settings.append(timeLabel, timeGroup, qualityLabel);

  const footer = el('footer', 'land-footer');
  const viewDetails = el('section', 'land-view-details');
  const viewNumber = el('span', 'land-view-number', '01');
  const text = el('div', 'land-view-text');
  const viewName = el('h2', '', PURE_LAND.views[0].title);
  const description = el('p', '', PURE_LAND.views[0].description);
  text.append(viewName, description);
  viewDetails.append(viewNumber, text);
  const actions = el('div', 'land-actions');
  const tourButton = button('land-tour', '▷　' + PURE_LAND.copy.tour, PURE_LAND.copy.tour);
  tourButton.setAttribute('aria-pressed', 'false');
  let touring = false;
  tourButton.addEventListener('click', () => events.emit('land:tour', { enabled: !touring }));
  const hideButton = button('land-icon-button', '⛶', '隐藏界面');
  const restore = button('land-restore', '显示界面 · H');
  restore.hidden = true;
  function hideUi(hidden: boolean): void {
    overlay.hidden = hidden;
    restore.hidden = !hidden;
  }
  hideButton.addEventListener('click', () => hideUi(true));
  restore.addEventListener('click', () => hideUi(false));
  actions.append(tourButton, hideButton);
  footer.append(viewDetails, actions);
  const hint = el(
    'div',
    'land-hint',
    capabilities.touch ? PURE_LAND.copy.touchControls : PURE_LAND.copy.controls,
  );
  const note = el('div', 'land-note', PURE_LAND.copy.note);
  const notice = el('div', 'land-notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  overlay.append(header, title, settings, footer, hint, note, notice);

  const dialog = el('dialog', 'land-dialog');
  dialog.setAttribute('aria-labelledby', 'land-source-title');
  const close = button('land-dialog-close', '×', '关闭造境手记');
  close.addEventListener('click', () => dialog.close());
  const sourceTitle = el('h2', '', PURE_LAND.copy.sourceTitle);
  sourceTitle.id = 'land-source-title';
  dialog.append(
    close,
    el('div', 'land-eyebrow', 'DESIGN NOTES / 造境手记'),
    sourceTitle,
    el('p', 'land-source-intro', PURE_LAND.copy.sourceIntro),
  );
  for (const [name, body] of PURE_LAND.copy.sourceItems) {
    const item = el('section', 'land-source-item');
    item.append(el('h3', '', name), el('p', '', body));
    dialog.append(item);
  }
  dialog.append(el('small', '', '文献索引：大正藏 T0366 · T0365　/　建筑与空间艺术设计'));
  sourceButton.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
  const touch = el('div', 'land-touch');
  const move = el('div', 'land-touch-pad', '移动');
  move.setAttribute('aria-label', '触控移动区');
  const look = el('div', 'land-touch-pad', '环顾');
  look.setAttribute('aria-label', '触控视角区');
  touch.append(move, look);
  touch.hidden = !capabilities.touch;
  root.append(overlay, restore, dialog, touch);

  const keyHandler = (event: KeyboardEvent): void => {
    if (dialog.open || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'KeyH') hideUi(!overlay.hidden);
    if (event.code === 'Escape' && overlay.hidden) hideUi(false);
  };
  window.addEventListener('keydown', keyHandler);
  removes.push(
    events.on('tod:changed', ({ to }) => {
      currentTime = to;
      for (const time of timeButtons)
        time.node.setAttribute('aria-pressed', String(time.id === to));
    }),
  );
  removes.push(
    events.on('land:state', ({ index, walking, touring: nextTouring }) => {
      touring = nextTouring;
      tourButton.textContent = touring ? 'Ⅱ　' + PURE_LAND.copy.pause : '▷　' + PURE_LAND.copy.tour;
      tourButton.setAttribute('aria-pressed', String(touring));
      tourButton.setAttribute('aria-label', touring ? PURE_LAND.copy.pause : PURE_LAND.copy.tour);
      overlay.classList.toggle('is-walking', walking);
      const view = PURE_LAND.views[index] ?? PURE_LAND.views[0];
      viewName.textContent = walking ? PURE_LAND.copy.walk : view.title;
      description.textContent = walking
        ? capabilities.touch
          ? PURE_LAND.copy.touchControls
          : PURE_LAND.copy.controls
        : view.description;
      viewNumber.textContent = walking ? '↟' : String(index + 1).padStart(2, '0');
      title.hidden = walking || index !== 0;
      viewButtons.forEach((node, i) =>
        node.setAttribute('aria-current', String(!walking && i === index)),
      );
    }),
  );
  viewButtons[0]?.setAttribute('aria-current', 'true');

  return {
    viewport,
    move,
    look,
    showNotice(message: string): void {
      notice.textContent = message;
      notice.hidden = false;
    },
    dispose(): void {
      for (const remove of removes) remove();
      window.removeEventListener('keydown', keyHandler);
      viewport.remove();
      overlay.remove();
      restore.remove();
      dialog.remove();
      touch.remove();
      root.classList.remove('land-app');
    },
  };
}
