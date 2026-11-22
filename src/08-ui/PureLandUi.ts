import type { AppEventMap, Capabilities, EventBusLike, QualityTier, TimeOfDayId } from '@/00-types';
import type { LandUiPreference } from '@/03-platform';
import { companionColor, LAND_LIGHT, LAND_QUALITY, LAND_SOUND, PURE_LAND } from '@/01-shared';

interface LandUiOptions {
  events: EventBusLike<AppEventMap>;
  capabilities: Capabilities;
  quality: QualityTier;
  autoQuality: boolean;
  readPreference: (key: LandUiPreference) => boolean | null;
  savePreference: (key: LandUiPreference, value: boolean) => void;
  onQualityChoice: (tier: QualityTier | null) => void;
  time: TimeOfDayId;
  noAudio: boolean;
  thirdPerson: boolean;
  roomEntry?: 'link' | 'join';
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
  let rightMove = options.readPreference('rightMove') ?? false;
  let walkingNow = false,
    flyingNow = false;
  const touchHint = (flight: boolean) =>
    `${rightMove ? '右下移动 · 左下环顾' : '左下移动 · 右下环顾'} · ${flight ? '＋/− 升降' : '点击景点切换视角'}`;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const removes: (() => void)[] = [];
  root.classList.add('land-app');
  const viewport = el('div', 'viewport land-viewport');
  const loading = el('div', 'land-loading');
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  const loadingText = el('span', 'land-loading-text', '正在分帧构建核心场景');
  loading.append(el('span', 'land-loading-spinner'), loadingText);
  loading.hidden = !options.thirdPerson;
  viewport.append(loading);
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
  const settingsButton = button('land-icon-button land-settings-toggle', '☷', '画面与声音设置');
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.setAttribute('aria-controls', 'land-settings');
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
  headerTools.append(sourceButton, audioButton, settingsButton);
  header.append(brand, navigation, headerTools);

  const title = el('section', 'land-title');
  const titleEyebrow = el('div', 'land-eyebrow', '西 方 净 土 · 数 字 造 境');
  const heading = el('h1', 'land-heading');
  heading.append(el('span', '', '西方'), el('span', '', '极乐'));
  const titleEn = el('div', 'land-title-en', PURE_LAND.english);
  const line = el('div', 'land-title-rule');
  const subtitle = el('p', 'land-subtitle', PURE_LAND.subtitle);
  const enter = button(
    'land-enter',
    options.roomEntry === 'join' ? '加入联机游历 ↗' : PURE_LAND.copy.enter + '　↗',
  );
  enter.addEventListener('click', () => events.emit('land:walk', {}));
  title.append(titleEyebrow, heading, titleEn, line, subtitle, enter);
  if (options.roomEntry === 'link') {
    const link = el('a', 'land-room-entry', '与伙伴同游 →');
    link.href = '/play';
    title.append(link);
  }

  const settings = el('aside', 'land-settings');
  settings.id = 'land-settings';
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
  const autoQuality = el(
    'option',
    '',
    options.autoQuality ? `自动 · ${LAND_QUALITY[options.quality]}` : '自动',
  );
  autoQuality.value = 'auto';
  quality.append(autoQuality);
  for (const tier of Object.keys(LAND_QUALITY) as QualityTier[]) {
    const option = el('option', '', LAND_QUALITY[tier]);
    option.value = tier;
    option.selected = !options.autoQuality && tier === options.quality;
    quality.append(option);
  }
  quality.addEventListener('change', () => {
    const chosen = quality.value === 'auto' ? null : (quality.value as QualityTier);
    if (chosen !== null && !Object.hasOwn(LAND_QUALITY, chosen)) return;
    options.onQualityChoice(chosen);
    const url = new URL(window.location.href);
    url.searchParams.delete('q');
    if (chosen === null) url.searchParams.delete('quality');
    else url.searchParams.set('quality', chosen);
    url.searchParams.set('tod', currentTime);
    window.location.href = url.href;
  });
  qualityLabel.append(quality);
  const volumeLabel = el('label', 'land-volume-label', '音量');
  const volume = el('input', 'land-volume');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.value = String(LAND_SOUND.defaultVolume * 100);
  volume.setAttribute('aria-label', '环境音量');
  volume.disabled = options.noAudio;
  volume.addEventListener('input', () =>
    events.emit('audio:volume', { value: Number(volume.value) / 100 }),
  );
  volumeLabel.append(volume);
  settings.append(timeLabel, timeGroup, qualityLabel, volumeLabel);
  const closeSettings = (): void => {
    settings.classList.remove('is-open');
    settingsButton.setAttribute('aria-expanded', 'false');
    touch.hidden = !capabilities.touch || dialog.open;
    events.emit('land:modal', { open: dialog.open });
  };
  settingsButton.addEventListener('click', () => {
    const open = settings.classList.toggle('is-open');
    settingsButton.setAttribute('aria-expanded', String(open));
    touch.hidden = open || !capabilities.touch;
    events.emit('land:modal', { open });
    notice.hidden = true;
  });

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
  const flightButton = button('land-flight-toggle', '起飞 · V', '起飞或安全降落');
  flightButton.hidden = true;
  flightButton.addEventListener('click', () => events.emit('land:flightToggle', {}));
  const hideButton = button('land-icon-button', '⛶', '隐藏界面');
  const restore = button('land-restore', '显示界面 · H');
  restore.hidden = true;
  function hideUi(hidden: boolean): void {
    overlay.hidden = hidden;
    restore.hidden = !hidden;
    closeSettings();
    (hidden ? restore : hideButton).focus({ preventScroll: true });
  }
  hideButton.addEventListener('click', () => hideUi(true));
  restore.addEventListener('click', () => hideUi(false));
  actions.append(tourButton, flightButton, hideButton);
  footer.append(viewDetails, actions);
  const hint = el(
    'div',
    'land-hint',
    options.thirdPerson
      ? capabilities.touch
        ? touchHint(false)
        : '左键环顾 · WASD 步行 · 滚轮调距 · V 起飞/降落 · H 隐藏界面'
      : capabilities.touch
        ? touchHint(false)
        : PURE_LAND.copy.controls,
  );
  const note = el('div', 'land-note', PURE_LAND.copy.note);
  const notice = el('div', 'land-notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  overlay.append(header, title, settings, footer, hint, note);

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
  sourceButton.addEventListener('click', () => {
    closeSettings();
    events.emit('land:modal', { open: true });
    touch.hidden = true;
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    events.emit('land:modal', { open: false });
    touch.hidden = !capabilities.touch;
    sourceButton.focus({ preventScroll: true });
  });
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
  const flightTouch = el('div', 'land-flight-touch');
  const ascend = button('land-flight-touch-button', '＋', '按住上升');
  const descend = button('land-flight-touch-button', '−', '按住下降');
  flightTouch.append(ascend, descend);
  flightTouch.hidden = true;
  move.append(el('span', 'land-touch-thumb'));
  look.append(el('span', 'land-touch-thumb'));
  touch.append(move, look, flightTouch);
  if (capabilities.touch) {
    const layout = el('select', 'land-quality land-touch-layout');
    const label = el('label', 'land-quality-label', '移动盘');
    for (const [value, text] of [
      ['left', '左手移动'],
      ['right', '右手移动'],
    ] as const) {
      const option = el('option', '', text);
      option.value = value;
      layout.append(option);
    }
    layout.value = rightMove ? 'right' : 'left';
    touch.classList.toggle('is-reversed', rightMove);
    layout.addEventListener('change', () => {
      rightMove = layout.value === 'right';
      options.savePreference('rightMove', rightMove);
      touch.classList.toggle('is-reversed', rightMove);
      hint.textContent = touchHint(flyingNow);
      if (walkingNow || flyingNow) description.textContent = touchHint(flyingNow);
    });
    label.append(layout);
    settings.append(label);
  }
  touch.hidden = !capabilities.touch;
  root.append(overlay, restore, dialog, touch, notice);

  const navigationHud = el('section', 'land-navigation-hud');
  navigationHud.setAttribute('aria-label', '当前位置与导航信息');
  navigationHud.setAttribute('aria-live', 'off');
  navigationHud.hidden = true;
  const navigationMode = el('div', 'land-navigation-mode', '步行');
  const navigationCoordinates = el('div', 'land-navigation-coordinates', 'X 0.0 · Y 0.0 · Z 0.0 m');
  const navigationHeading = el('div', 'land-navigation-heading', '北 · 0°');
  const navigationDestination = el('div', 'land-navigation-destination', '');
  navigationHud.append(
    navigationMode,
    navigationCoordinates,
    navigationHeading,
    navigationDestination,
  );
  overlay.append(navigationHud);

  function setNotice(message: string, temporary = false): void {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.hidden = false;
    if (temporary)
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
      }, 5000);
  }

  const keyHandler = (event: KeyboardEvent): void => {
    if (!dialog.open && event.code === 'Escape' && settings.classList.contains('is-open')) {
      closeSettings();
      settingsButton.focus({ preventScroll: true });
      return;
    }
    if (
      dialog.open ||
      event.repeat ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLInputElement
    )
      return;
    if (event.code === 'KeyH') hideUi(!overlay.hidden);
    if (event.code === 'Escape' && overlay.hidden) hideUi(false);
  };
  window.addEventListener('keydown', keyHandler);
  const resizeSettings = (): void => {
    if (settings.classList.contains('is-open') && settingsButton.offsetWidth === 0) closeSettings();
  };
  window.addEventListener('resize', resizeSettings);
  removes.push(
    events.on('tod:changed', ({ to }) => {
      currentTime = to;
      for (const time of timeButtons)
        time.node.setAttribute('aria-pressed', String(time.id === to));
    }),
  );
  removes.push(
    events.on('land:state', ({ index, walking, flying, touring: nextTouring }) => {
      walkingNow = walking;
      flyingNow = flying;
      if (capabilities.touch) hint.textContent = touchHint(flying);
      touring = nextTouring;
      tourButton.textContent = touring ? 'Ⅱ　' + PURE_LAND.copy.pause : '▷　' + PURE_LAND.copy.tour;
      tourButton.setAttribute('aria-pressed', String(touring));
      tourButton.setAttribute('aria-label', touring ? PURE_LAND.copy.pause : PURE_LAND.copy.tour);
      const roaming = walking || flying;
      overlay.classList.toggle('is-walking', roaming && !flying);
      overlay.classList.toggle('is-flying', flying);
      const view = PURE_LAND.views[index] ?? PURE_LAND.views[0];
      viewName.textContent = flying ? '高空观察' : walking ? PURE_LAND.copy.walk : view.title;
      description.textContent = flying
        ? capabilities.touch
          ? touchHint(true)
          : 'WASD 平移 · E/Q 升降 · V 请求降落'
        : walking
          ? capabilities.touch
            ? touchHint(false)
            : PURE_LAND.copy.controls
          : view.description;
      viewNumber.textContent = roaming ? (flying ? '⌃' : '↟') : String(index + 1).padStart(2, '0');
      title.hidden = roaming || index !== 0;
      viewButtons.forEach((node, i) =>
        node.setAttribute('aria-current', String(!roaming && i === index)),
      );
    }),
  );
  removes.push(
    events.on('land:state', ({ walking, flying }) => {
      flightButton.hidden = !options.thirdPerson || (!walking && !flying);
      flightButton.textContent = flying ? '降落 · V' : '起飞 · V';
      flightButton.setAttribute('aria-label', flying ? '请求安全降落' : '起飞');
      flightTouch.hidden = !capabilities.touch || !flying;
      navigationHud.hidden = !options.thirdPerson || (!walking && !flying);
      navigationMode.textContent = flying ? '飞行观察' : '步行漫游';
      tourButton.disabled = flying;
      overlay.classList.toggle('is-flying', flying);
    }),
  );
  removes.push(
    events.on('land:navigation', (info) => {
      if (!options.thirdPerson) return;
      navigationMode.textContent = info.flying ? '飞行观察' : '步行漫游';
      navigationCoordinates.textContent = `X ${info.x.toFixed(1)} · Y ${info.y.toFixed(1)} · Z ${info.z.toFixed(1)} m`;
      navigationHeading.textContent = `${info.direction} · ${Math.round(info.headingDeg)}°`;
      navigationDestination.textContent = `${info.area} · 最近地标 ${info.landmark} ${Math.round(info.distance)} m`;
    }),
  );
  removes.push(
    events.on('land:flightNotice', ({ message }) => {
      setNotice(message, true);
    }),
  );
  viewButtons[0]?.setAttribute('aria-current', 'true');

  return {
    viewport,
    mountRoomStatus(onRetry: () => void) {
      const row = el('div', 'land-room-status');
      const nearby = el('div', 'land-room-nearest');
      const roster = el('label', 'land-room-roster', '导航目标 ');
      const target = el('select', 'land-room-target');
      roster.append(target);
      roster.hidden = true;
      nearby.hidden = true;
      row.setAttribute('role', 'status');
      const retry = button('land-room-retry', '回入口重连');
      retry.hidden = true;
      retry.addEventListener('click', onRetry);
      const toggle = button('land-room-details-toggle', '');
      const details = el('div', 'land-room-details');
      details.id = 'land-room-details';
      toggle.setAttribute('aria-controls', details.id);
      // 只在联机卡内重排既有导航节点，保留坐标和地标事件的原引用。
      details.append(
        navigationMode,
        navigationCoordinates,
        navigationHeading,
        navigationDestination,
        nearby,
        roster,
      );
      navigationHud.append(row, toggle, retry, details);
      const expand = (expanded: boolean) => {
        details.hidden = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? '收起导航' : '展开导航';
        toggle.setAttribute('aria-label', toggle.textContent);
      };
      expand(
        options.readPreference('navigationExpanded') ??
          (!capabilities.touch && !window.matchMedia('(max-width: 700px)').matches),
      );
      const toggleDetails = () => {
        const expanded = Boolean(details.hidden);
        options.savePreference('navigationExpanded', expanded);
        expand(expanded);
      };
      toggle.addEventListener('click', toggleDetails);
      return {
        set(text: string, canRetry = false) {
          if (row.textContent !== text) row.textContent = text;
          retry.hidden = !canRetry;
        },
        nearest(text: string) {
          if (nearby.textContent !== text) {
            nearby.textContent = text;
            nearby.hidden = !text;
          }
        },
        roster(ids: readonly string[]) {
          const previous = target.value;
          const auto = el('option', '', '自动 · 最近伙伴');
          auto.value = '';
          target.replaceChildren(auto);
          for (const id of ids) {
            const option = el('option', '', `${companionColor(id).name} #${id}`);
            option.value = id;
            target.append(option);
          }
          target.value = ids.includes(previous) ? previous : '';
          roster.hidden = !ids.length;
        },
        selectedId() {
          return target.value;
        },
        dispose() {
          toggle.removeEventListener('click', toggleDetails);
          toggle.remove();
          navigationHud.append(
            navigationMode,
            navigationCoordinates,
            navigationHeading,
            navigationDestination,
          );
          details.remove();
          retry.removeEventListener('click', onRetry);
          retry.remove();
          nearby.remove();
          row.remove();
        },
      };
    },
    move,
    look,
    ascend,
    descend,
    touchFeedback(pad: 'move' | 'look', active: boolean, x: number, y: number): void {
      const target = pad === 'move' ? move : look;
      target.dataset['active'] = String(active);
      target.style.setProperty('--touch-x', `${x * 25}px`);
      target.style.setProperty('--touch-y', `${y * 25}px`);
    },
    showNotice(message: string, temporary = false): void {
      setNotice(message, temporary);
    },
    setLoading(active: boolean, message = '正在分帧构建核心场景'): void {
      loadingText.textContent = message;
      loading.hidden = !active;
    },
    dispose(): void {
      clearTimeout(noticeTimer);
      for (const remove of removes) remove();
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('resize', resizeSettings);
      viewport.remove();
      overlay.remove();
      restore.remove();
      dialog.remove();
      touch.remove();
      notice.remove();
      navigationHud.remove();
      root.classList.remove('land-app');
    },
  };
}
