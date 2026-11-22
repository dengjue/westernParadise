import type { AppEventMap } from '@/00-types';
import { horizontalHint, LAND_STOPS, landStopArrival } from '@/01-shared';

/** 仅在本页导航详情内使用；个人选择与多人协议独立。 */
export function mountLandDestination() {
  const root = document.createElement('div');
  root.className = 'land-personal-guide';
  const label = document.createElement('label');
  label.textContent = '游览目的地 ';
  const selector = document.createElement('select');
  selector.className = 'land-room-target land-stop-target';
  selector.add(new Option('自由游历', ''));
  for (const stop of LAND_STOPS) selector.add(new Option(stop.name, stop.id));
  const hint = document.createElement('div');
  hint.className = 'land-stop-hint';
  label.append(selector);
  root.append(label, hint);
  let latest: AppEventMap['land:navigation'] | undefined;
  let near = false;
  function update() {
    const stop = LAND_STOPS.find((s) => s.id === selector.value);
    let text = '';
    if (stop && latest) {
      const [x, z] = stop.point;
      const { direction, distance } = horizontalHint(x, z, latest);
      const arrival = landStopArrival(distance, latest.flying, near);
      near = arrival !== 'away';
      text =
        arrival === 'arrived'
          ? `已抵达：${stop.name}`
          : arrival === 'overhead'
            ? `${stop.name} · 正在上空经过`
            : `${stop.name} · ${direction} ${Math.round(distance)} m（水平直线）`;
    }
    if (hint.textContent !== text) hint.textContent = text;
  }
  selector.addEventListener('change', () => {
    near = false;
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
