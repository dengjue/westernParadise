import type { AppEventMap } from '@/00-types';
import { mountLandTourMap } from './LandTourMap';
import { readLandGuideSession, writeLandGuideSession } from '@/03-platform';
import {
  horizontalHint,
  LAND_STOPS,
  LAND_TOURS,
  LAND_STOP_NOTES,
  measureTour,
  landStopArrival,
} from '@/01-shared';

/** 仅在本页导航详情内使用；个人选择与多人协议独立。 */
export function mountLandDestination() {
  const root = document.createElement('div');
  root.className = 'land-personal-guide';
  const label = document.createElement('label');
  label.textContent = '游览目的地 ';
  const selector = document.createElement('select');
  selector.className = 'land-stop-target';
  selector.add(new Option('自由游历', ''));
  for (const tour of LAND_TOURS) selector.add(new Option(`${tour.name} · 逐站导览`, tour.id));
  for (const stop of LAND_STOPS) selector.add(new Option(stop.name, stop.id));
  const hint = document.createElement('div');
  hint.className = 'land-stop-hint';
  const note = document.createElement('div');
  note.className = 'land-stop-note';
  note.hidden = true;
  label.append(selector);
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'land-stop-next';
  next.hidden = true;
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'land-stop-next land-stop-restart';
  restart.textContent = '重新游览此线';
  restart.hidden = true;
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'land-stop-next land-stop-pause';
  pause.hidden = true;
  root.append(label, hint, note, next, restart, pause);
  const preview = document.createElement('details');
  preview.className = 'land-stop-preview';
  const summary = document.createElement('summary');
  summary.textContent = '游线站点';
  const list = document.createElement('ol');
  const progress = document.createElement('div');
  progress.className = 'land-tour-progress';
  const map = mountLandTourMap();
  preview.append(summary, progress, map.root, map.legend, map.caption, list);
  root.append(preview);
  preview.hidden = true;
  let latest: AppEventMap['land:navigation'] | undefined;
  let near = false;
  let paused = false;
  let stage = 0,
    visited = false;
  const saved = readLandGuideSession();
  if (saved) {
    selector.value = saved.choice;
    stage = saved.stage;
    paused = saved.paused ?? false;
  }
  const save = () =>
    writeLandGuideSession(selector.value ? { choice: selector.value, stage, paused } : null);
  function update() {
    const tour = LAND_TOURS.find((t) => t.id === selector.value);
    const stop = tour ? tour.stops[stage] : LAND_STOPS.find((s) => s.id === selector.value);
    let text = '';
    let noteText = '';
    if (stop && latest && !paused) {
      const [x, z] = stop.point;
      const { direction, distance } = horizontalHint(x, z, latest);
      const arrival = landStopArrival(distance, latest.flying, near);
      if (arrival === 'arrived') {
        visited = true;
        noteText = LAND_STOP_NOTES[stop.id];
      }
      near = arrival !== 'away';
      text =
        arrival === 'arrived'
          ? `已抵达：${stop.name}`
          : arrival === 'overhead'
            ? `${stop.name} · 正在上空经过`
            : `${stop.name} · ${direction} ${Math.round(distance)} m（水平直线）`;
      if (tour) text = `第 ${stage + 1}/${tour.stops.length} 站 · ${text}`;
    }
    if (tour && !stop) text = `${tour.name}已完成 · 可改选自由游历或其他目的地`;
    if (tour && stop && paused) text = `${tour.name}已暂停 · 保留第 ${stage + 1} 站`;
    pause.hidden = !tour || !stop;
    pause.textContent = paused ? '继续导览' : '暂停导览';
    pause.setAttribute('aria-pressed', String(paused));
    next.hidden = !tour || !stop || !visited || paused;
    restart.hidden = !tour || stage === 0;
    const action = tour && stage === tour.stops.length - 1 ? '完成游线' : '前往下一站';
    if (next.textContent !== action) next.textContent = action;
    if (hint.textContent !== text) hint.textContent = text;
    if (note.textContent !== noteText) {
      note.textContent = noteText;
      note.hidden = !noteText;
    }
  }
  // 名单只在选择或确认站次时重建，不随每次距离更新写入。
  function refreshPreview() {
    const tour = LAND_TOURS.find((t) => t.id === selector.value);
    preview.hidden = !tour;
    if (!tour) preview.open = false;
    list.replaceChildren();
    if (!tour) return;
    map.route(tour.stops, stage);
    const { legs, total } = measureTour(tour.stops);
    // stage 是已手动确认的站数；排除通向当前站的路段，避免误作实时剩余路程。
    const following = legs.slice(stage + 1).reduce((sum, distance) => sum + distance, 0);
    progress.textContent = `已确认 ${stage}/${tour.stops.length} 站`;
    if (stage < tour.stops.length)
      progress.textContent += ` · 当前站之后约 ${Math.round(following)} m（不含前往当前站）`;
    summary.textContent = `游线站点 · 全程约 ${Math.round(total)} m`;
    tour.stops.forEach((stop, i) => {
      const item = document.createElement('li');
      item.textContent = `${stop.name} · ${i < stage ? '已完成' : i === stage ? '当前' : '待游'}`;
      if (i > 0) item.textContent += ` · 距上站约 ${Math.round(legs[i]!)} m`;
      if (i === stage) item.setAttribute('aria-current', 'step');
      list.append(item);
    });
    list.setAttribute('aria-label', '各站间水平直线距离');
  }
  refreshPreview();
  function updateMap() {
    if (preview.open && !preview.hidden && latest)
      map.position(latest.x, latest.z, latest.headingDeg, latest.flying);
  }
  preview.addEventListener('toggle', updateMap);
  function resetTour() {
    paused = false;
    near = false;
    stage = 0;
    visited = false;
    save();
    refreshPreview();
    update();
    updateMap();
  }
  selector.addEventListener('change', resetTour);
  pause.addEventListener('click', () => {
    paused = !paused;
    // 暂停不保留未确认的到站资格，继续时重新按当前位置判断。
    near = visited = false;
    save();
    update();
  });
  restart.addEventListener('click', () => {
    resetTour();
    // 重置后按钮隐藏，将键盘焦点交回仍可操作的目的地选择器。
    selector.focus();
  });
  next.addEventListener('click', () => {
    const tour = LAND_TOURS.find((t) => t.id === selector.value);
    if (!tour || !visited || paused || stage >= tour.stops.length) return;
    stage++;
    save();
    refreshPreview();
    near = visited = false;
    update();
    updateMap();
  });
  return {
    root,
    navigation(info: AppEventMap['land:navigation']) {
      latest = info;
      update();
      updateMap();
    },
  };
}
