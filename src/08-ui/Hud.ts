import type { AppEventMap, EventBusLike, QualityTier, TimeOfDayId, WeatherId } from '@/00-types';
import { APP, COPY, TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '@/01-shared';

export interface HudOptions {
  readonly parent: HTMLElement;
  readonly events: EventBusLike<AppEventMap>;
  readonly quality: QualityTier;
  readonly timeOfDay: TimeOfDayId;
  readonly weather: WeatherId;
  readonly smoke: boolean;
}

export interface HudHandle {
  readonly root: HTMLElement;
  setStatus(text: string): void;
  showNotice(text: string): void;
  dispose(): void;
}

const TIME_OF_DAY_ORDER: readonly TimeOfDayId[] = Object.freeze(
  Object.keys(TIME_OF_DAY_PRESETS) as TimeOfDayId[],
);
const WEATHER_ORDER: readonly WeatherId[] = Object.freeze(
  Object.keys(WEATHER_PRESETS) as WeatherId[],
);

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(className: string, text: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = text;
  node.title = label;
  node.setAttribute('aria-label', label);
  return node;
}

function nextValue<T extends string>(current: T, order: readonly T[]): T {
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] ?? order[0] ?? current;
}

/**
 * HUD 宿主：只负责展示状态和发出用户请求，不直接改写光照/天气状态。
 * 时段、天气按钮的文字只在对应 changed 事件到达后更新，避免 UI 与渲染侧出现双份状态。
 */
export function mountHud(options: HudOptions): HudHandle {
  const { events } = options;
  let currentTimeOfDay = options.timeOfDay;
  let currentWeather = options.weather;

  const hud = element('div', 'hud');
  const topLeft = element('div', 'hud-top-left');
  const brand = element('div', 'hud-brand', APP.name);
  const state = element('div', 'hud-state');
  const timeButton = button(
    'hud-control hud-time-control',
    COPY.timeOfDay[currentTimeOfDay],
    COPY.switchHint.timeOfDay,
  );
  const weatherButton = button(
    'hud-control hud-weather-control',
    COPY.weather[currentWeather],
    COPY.switchHint.weather,
  );
  state.append(timeButton, weatherButton);
  topLeft.append(brand, state);

  const topRight = element('div', 'hud-top-right');
  const quality = element('div', 'hud-quality', `${COPY.qualityLabel} ${options.quality}`);
  const aboutButton = button('hud-control hud-about-toggle', COPY.aboutLabel, COPY.aboutLabel);
  const about = element('div', 'hud-about', COPY.about);
  about.hidden = true;
  aboutButton.setAttribute('aria-expanded', 'false');
  topRight.append(quality, aboutButton, about);

  const controls = element('div', 'hud-controls', COPY.controlsHint);
  const status = element('div', 'hud-status', COPY.loading);
  const notice = element('div', 'hud-notice');
  notice.hidden = true;

  hud.append(topLeft, topRight, controls, status, notice);
  if (options.smoke) {
    hud.append(element('div', 'hud-smoke-badge', COPY.smokeBadge));
  }
  options.parent.append(hud);

  const onTimeButtonClick = (): void => {
    events.emit('tod:request', { to: nextValue(currentTimeOfDay, TIME_OF_DAY_ORDER) });
  };
  const onWeatherButtonClick = (): void => {
    events.emit('weather:request', { to: nextValue(currentWeather, WEATHER_ORDER) });
  };
  const onAboutButtonClick = (): void => {
    const expanded = about.hidden;
    about.hidden = !expanded;
    aboutButton.setAttribute('aria-expanded', String(expanded));
  };
  const offTimeChanged = events.on('tod:changed', ({ to }) => {
    currentTimeOfDay = to;
    timeButton.textContent = COPY.timeOfDay[to];
  });
  const offWeatherChanged = events.on('weather:changed', ({ to }) => {
    currentWeather = to;
    weatherButton.textContent = COPY.weather[to];
  });

  timeButton.addEventListener('click', onTimeButtonClick);
  weatherButton.addEventListener('click', onWeatherButtonClick);
  aboutButton.addEventListener('click', onAboutButtonClick);

  return {
    root: hud,
    setStatus(text) {
      status.textContent = text;
    },
    showNotice(text) {
      notice.textContent = text;
      notice.hidden = false;
    },
    dispose() {
      offTimeChanged();
      offWeatherChanged();
      timeButton.removeEventListener('click', onTimeButtonClick);
      weatherButton.removeEventListener('click', onWeatherButtonClick);
      aboutButton.removeEventListener('click', onAboutButtonClick);
      hud.remove();
    },
  };
}
