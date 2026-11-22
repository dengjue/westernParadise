import type { AppEventMap } from '@/00-types';
import { readLandGuideSession, writeLandGuideSession } from '@/03-platform';
import { horizontalHint, LAND_STOPS, LAND_TOURS, landStopArrival } from '@/01-shared';

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
  label.append(selector);
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'land-stop-next';
  next.hidden = true;
  root.append(label, hint, next);
  let latest: AppEventMap['land:navigation'] | undefined;
  let near = false;
  let stage = 0,
    visited = false;
  const saved = readLandGuideSession();
  if (saved) {
    selector.value = saved.choice;
    stage = saved.stage;
  }
  const save = () =>
    writeLandGuideSession(selector.value ? { choice: selector.value, stage } : null);
  function update() {
    const tour = LAND_TOURS.find((t) => t.id === selector.value);
    const stop = tour ? tour.stops[stage] : LAND_STOPS.find((s) => s.id === selector.value);
    let text = '';
    if (stop && latest) {
      const [x, z] = stop.point;
      const { direction, distance } = horizontalHint(x, z, latest);
      const arrival = landStopArrival(distance, latest.flying, near);
      if (arrival === 'arrived') visited = true;
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
    next.hidden = !tour || !stop || !visited;
    const action = tour && stage === tour.stops.length - 1 ? '完成游线' : '前往下一站';
    if (next.textContent !== action) next.textContent = action;
    if (hint.textContent !== text) hint.textContent = text;
  }
  selector.addEventListener('change', () => {
    near = false;
    stage = 0;
    visited = false;
    save();
    update();
  });
  next.addEventListener('click', () => {
    const tour = LAND_TOURS.find((t) => t.id === selector.value);
    if (!tour || !visited || stage >= tour.stops.length) return;
    stage++;
    save();
    near = visited = false;
    update();
  });
  return {
    root,
    navigation(info: AppEventMap['land:navigation']) {
      latest = info;
      update();
    },
  };
}
