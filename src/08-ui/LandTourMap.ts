import type { LAND_STOPS } from '@/01-shared';

type Stop = (typeof LAND_STOPS)[number];
const WIDTH = 180,
  HEIGHT = 108,
  PAD = 14;
const SINGLE_STOP_SPAN = 60;
const SCALE_METERS = 20;

/** 同一比例投影 X/Z，负 Z（北）指向图面上方；单轴路线也能正常居中。 */
export function tourProjection(stops: readonly Stop[]) {
  const xs = stops.map((s) => s.point[0]),
    zs = stops.map((s) => s.point[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  const scale = Math.min(
    (WIDTH - 2 * PAD) / Math.max(stops.length === 1 ? SINGLE_STOP_SPAN : 1, x1 - x0),
    (HEIGHT - 2 * PAD) / Math.max(stops.length === 1 ? SINGLE_STOP_SPAN : 1, z1 - z0),
  );
  return (x: number, z: number) => ({
    x: WIDTH / 2 + (x - (x0 + x1) / 2) * scale,
    y: HEIGHT / 2 + (z - (z0 + z1) / 2) * scale,
  });
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export function mountLandTourMap() {
  let project: ReturnType<typeof tourProjection> | undefined;
  const arrow = svg('path', {
    class: 'land-tour-self',
    d: 'M0 -7 L4 4 L0 2 L-4 4 Z',
    fill: '#6dd7ff',
    stroke: '#133849',
    'stroke-width': 1,
  });
  const caption = document.createElement('small');
  caption.className = 'land-tour-map-caption';
  const legend = document.createElement('small');
  legend.className = 'land-tour-map-legend';
  legend.textContent = '金色：当前站 · 绿色：已完成 · 灰色：待游';
  const scaleBar = svg('svg', {
    class: 'land-tour-scale',
    viewBox: `0 0 ${WIDTH} 22`,
    role: 'img',
    'aria-label': `水平比例尺 ${SCALE_METERS} 米`,
  });
  const root = svg('svg', {
    class: 'land-tour-map',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: 'img',
    'aria-label': '游线示意图，北向上，编号对应站点清单',
  });
  return {
    root,
    caption,
    legend,
    scaleBar,
    position(x: number, z: number, headingDeg: number, flying: boolean) {
      if (!project) return;
      const pos = project(x, z);
      const inside = pos.x >= 0 && pos.x <= WIDTH && pos.y >= 0 && pos.y <= HEIGHT;
      const location = inside ? '蓝色箭头：自己与朝向' : '当前位置在图外 · 请参考目的地方向';
      const text = `${location} · ${flying ? '飞行中（仅水平位置）' : '地面游历'}`;
      if (caption.textContent !== text) caption.textContent = text;
      if (!inside) {
        arrow.setAttribute('visibility', 'hidden');
        return;
      }
      arrow.removeAttribute('visibility');
      const transform = `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)}) rotate(${Math.round(headingDeg)})`;
      if (arrow.getAttribute('transform') !== transform) arrow.setAttribute('transform', transform);
    },
    route(stops: readonly Stop[], stage: number) {
      const current = stops[stage];
      const single = stops.length === 1;
      legend.textContent = single ? '金色：目的地' : '金色：当前站 · 绿色：已完成 · 灰色：待游';
      root.setAttribute(
        'aria-label',
        single
          ? `${current!.name}周边位置示意图，北向上`
          : `游线示意图，北向上，编号对应站点清单；${current ? `当前第 ${stage + 1} 站：${current.name}` : '全部站点已完成'}`,
      );
      const projection = tourProjection(stops);
      project = projection;
      // 比例尺复用地图投影的横向比例；独立图行避免遮挡站点与玩家箭头。
      const length = projection(SCALE_METERS, 0).x - projection(0, 0).x;
      const bar = svg('path', {
        d: `M4 10 V16 H${4 + length} V10`,
        fill: 'none',
        stroke: 'currentColor',
      });
      const scaleLabel = svg('text', { x: 4, y: 8, fill: 'currentColor', 'font-size': 8 });
      scaleLabel.textContent = `${SCALE_METERS} m`;
      scaleBar.replaceChildren(bar, scaleLabel);
      const points = stops.map(({ point: [x, z] }) => projection(x, z));
      const line = svg('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        fill: 'none',
        stroke: '#b8b395',
        'stroke-width': 2,
      });
      const north = svg('text', { x: 4, y: 12, fill: '#e7dfc5', 'font-size': 9 });
      north.textContent = '↑ 北';
      root.replaceChildren(line, north);
      points.forEach(({ x, y }, i) => {
        const dot = svg('circle', {
          cx: x,
          cy: y,
          r: 6,
          fill: i === stage ? '#f1d196' : i < stage ? '#abd6b5' : '#d3d4c9',
        });
        const num = svg('text', {
          x,
          y: y + 3,
          'text-anchor': 'middle',
          fill: '#192927',
          'font-size': 9,
        });
        num.textContent = String(i + 1);
        root.append(dot, num);
      });
      arrow.setAttribute('visibility', 'hidden');
      root.append(arrow);
    },
  };
}
