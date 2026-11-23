import type { LAND_STOPS } from '@/01-shared';

type Stop = (typeof LAND_STOPS)[number];
const WIDTH = 180,
  HEIGHT = 108,
  PAD = 14;

/** 同一比例投影 X/Z，负 Z（北）指向图面上方；单轴路线也能正常居中。 */
export function tourProjection(stops: readonly Stop[]) {
  const xs = stops.map((s) => s.point[0]),
    zs = stops.map((s) => s.point[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  const scale = Math.min(
    (WIDTH - 2 * PAD) / Math.max(1, x1 - x0),
    (HEIGHT - 2 * PAD) / Math.max(1, z1 - z0),
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
  const root = svg('svg', {
    class: 'land-tour-map',
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: 'img',
    'aria-label': '游线示意图，北向上，编号对应站点清单',
  });
  return {
    root,
    route(stops: readonly Stop[], stage: number) {
      const project = tourProjection(stops);
      const points = stops.map(({ point: [x, z] }) => project(x, z));
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
    },
  };
}
