import type { LAND_STOPS } from '@/01-shared';

type Stop = (typeof LAND_STOPS)[number];
const WIDTH = 180,
  HEIGHT = 108,
  PAD = 14;
const SINGLE_STOP_SPAN = 60;

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
  const root = svg('svg', {
    class: 'land-tour-map',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: 'img',
    'aria-label': '游线示意图，北向上，编号对应站点清单',
  });
  return {
    root,
    position(x: number, z: number, headingDeg: number) {
      if (!project) return;
      const pos = project(x, z);
      const inside = pos.x >= 0 && pos.x <= WIDTH && pos.y >= 0 && pos.y <= HEIGHT;
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
      root.setAttribute(
        'aria-label',
        single
          ? `${current!.name}周边位置示意图，北向上`
          : `游线示意图，北向上，编号对应站点清单；${current ? `当前第 ${stage + 1} 站：${current.name}` : '全部站点已完成'}`,
      );
      const projection = tourProjection(stops);
      project = projection;
      const points = stops.map(({ point: [x, z] }) => projection(x, z));
      const line = svg('polyline', {
        points: points.map((p) => `${p.x},${p.y}`).join(' '),
        fill: 'none',
        stroke: '#b8b395',
        'stroke-width': 2,
      });
      // 用简单朝北指针取代方位说明文字；地图本身的 aria-label 保留语义。
      const north = svg('path', {
        d: 'M8 5 L5 12 L8 10 L11 12 Z',
        fill: '#e7dfc5',
        'aria-hidden': 'true',
      });
      root.replaceChildren(line, north);
      points.forEach(({ x, y }, i) => {
        const dot = svg('circle', {
          cx: x,
          cy: y,
          r: i === stage ? 6 : 4.5,
          fill: i === stage ? '#f1d196' : i < stage ? '#abd6b5' : '#d3d4c9',
          stroke: i === stage ? '#fff0cc' : '#203832',
          'stroke-width': i === stage ? 1.2 : 0.6,
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
