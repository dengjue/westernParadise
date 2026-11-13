import { LatheGeometry, Vector2 } from 'three';
import { LAND_CRAFT, LAND_DETAIL, LAND_STRUCTURE } from '@/01-shared';
import type { LandDetail } from '@/01-shared';
import type { PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';
import {
  faceRelief,
  profileFront,
  profileSurface,
  robeRelief,
  sculptedPetal,
  taperedSleeve,
} from './CraftGeometry';

/** 造像采用连续衣褶轮廓、叠腿、面部与发髻；所有形体为静态建筑陈设。 */
function seatedFigure(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  scale: number,
  detail: LandDetail,
): void {
  const craft = LAND_CRAFT.figure,
    settings = LAND_DETAIL[detail];
  const base = LAND_STRUCTURE.hall.base + craft.baseOffset;
  const body = m.sculpture;
  const p = (px: number, py: number, pz: number): [number, number, number] => [
    x + px * scale,
    base + py * scale,
    z + pz * scale,
  ];
  const s = (a: number, b: number, c: number): [number, number, number] => [
    a * scale,
    b * scale,
    c * scale,
  ];
  const pedestal = new LatheGeometry(
    craft.pedestal.map(([r, y]) => new Vector2(r, y)),
    settings.figureSegments,
  );
  builder.shape(pedestal, m.goldDark, p(0, 0, 0), s(1, 1, 1));
  pedestal.dispose();
  builder.cylinder(m.gold, p(0, 1.05, 0), 3.1 * scale, 0.18 * scale);
  builder.cylinder(body, p(0, 1.35, 0.2), 2.45 * scale, 0.5 * scale);
  const petal = sculptedPetal();
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < settings.radialSegments; i++) {
      const angle = ((i + ring * 0.5) / settings.radialSegments) * Math.PI * 2;
      const radius = 1.55 + ring * 0.1;
      builder.shape(
        petal,
        m.gold,
        p(Math.sin(angle) * radius, 0.82 + ring * 0.26, Math.cos(angle) * radius),
        s(1.0, 1.0, 1.0 - ring * 0.08),
        angle,
      );
    }
  }
  petal.dispose();
  const robe = profileSurface(craft.robe, settings.figureRows, settings.figureSegments, robeRelief);
  builder.shape(robe, body, p(0, 0, 0), s(1, 1, 1));
  robe.dispose();
  const head = profileSurface(craft.head, settings.figureRows, settings.figureSegments, faceRelief);
  builder.shape(head, body, p(0, 0, 0), s(1, 1, 1));
  head.dispose();
  builder.sphere(m.dark, p(0, 7.83, -0.09), s(0.75, 0.4, 0.65));
  builder.sphere(m.dark, p(0, 8.28, -0.1), s(0.32, 0.38, 0.3));
  for (let row = 0; row < 5; row++)
    for (let curl = 0; curl < 18; curl++) {
      const angle = ((curl + row * 0.5) / 18) * Math.PI * 2;
      const radius = 0.74 * Math.cos(((row / 6) * Math.PI) / 2);
      builder.sphere(
        m.goldDark,
        p(Math.sin(angle) * radius, 7.65 + row * 0.13, Math.cos(angle) * radius * 0.86 - 0.09),
        s(0.08, 0.075, 0.08),
      );
    }
  if (x !== 0) {
    for (let jewel = -2; jewel <= 2; jewel++) {
      builder.tube(
        m.gold,
        [
          p(jewel * 0.31, 7.75, 0.62),
          p(jewel * 0.35, 8.35, 0.6),
          p(jewel * 0.28, 8.6 - Math.abs(jewel) * 0.16, 0.5),
        ],
        0.08 * scale,
        7,
      );
      builder.sphere(
        m.pearl,
        p(jewel * 0.28, 8.6 - Math.abs(jewel) * 0.16, 0.5),
        s(0.11, 0.15, 0.1),
      );
    }
  }
  const facePoint = (px: number, py: number): [number, number, number] =>
    p(px, py, profileFront(craft.head, px, py, faceRelief) - craft.surfaceInset);
  for (const side of [-1, 1]) {
    builder.sphere(body, p(side * 0.76, 6.88, -0.01), s(0.18, 0.51, 0.21));
    const sleeve = taperedSleeve(
      craft.arm.map(([px, py, pz]) => [px * side, py, pz]),
      craft.armRadii,
      settings.figureRows,
    );
    builder.shape(sleeve, body, p(0, 0, 0), s(1, 1, 1));
    sleeve.dispose();
    builder.sphere(body, p(side * 0.3, 2.94, 1.13), s(0.4, 0.16, 0.27));
    for (let finger = 0; finger < 4; finger++) {
      builder.tube(
        body,
        [
          p(side * 0.42, 3.04, 1.0 + finger * 0.1),
          p(side * 0.19, 3.07, 1.0 + finger * 0.1),
          p(side * 0.02, 3.02, 1.0 + finger * 0.1),
        ],
        0.055 * scale,
        7,
      );
    }
    builder.tube(
      m.goldDark,
      [facePoint(side * 0.55, 7.16), facePoint(side * 0.34, 7.11), facePoint(side * 0.16, 7.15)],
      0.024 * scale,
      8,
    );
    builder.tube(
      m.goldDark,
      [facePoint(side * 0.56, 7.34), facePoint(side * 0.35, 7.4), facePoint(side * 0.16, 7.35)],
      0.03 * scale,
      8,
    );
  }
  builder.tube(
    m.goldDark,
    [
      facePoint(-0.22, craft.mouth.y),
      facePoint(0, craft.mouth.y - 0.015),
      facePoint(0.22, craft.mouth.y),
    ],
    0.025 * scale,
    10,
  );
  builder.sphere(m.pearl, facePoint(0, 7.48), s(0.055, 0.055, 0.045));
  // 密采样领缘沿连续胸腹表面铺设；细线嵌入衣料，不再跨空悬在身体前方。
  for (let hem = 0; hem < 2; hem++) {
    const points: [number, number, number][] = [];
    for (let sample = 0; sample <= settings.figureRows; sample++) {
      const t = sample / settings.figureRows;
      const px = -1.13 + t * 2.1 + hem * 0.07;
      const py = 5.52 - t * 2.5;
      points.push(p(px, py, profileFront(craft.robe, px, py, robeRelief)));
    }
    builder.tube(m.sculptureFold, points, 0.025 * scale, settings.figureRows);
  }
  for (let i = 0; i < 3; i++)
    builder.ring(
      i === 1 ? m.glow : m.gold,
      p(0, 6.5, -1.05),
      (2.3 + i * 0.22) * scale,
      (i === 1 ? 0.025 : 0.05) * scale,
    );
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    builder.sphere(
      m.gold,
      p(Math.sin(a) * 2.85, 6.5 + Math.cos(a) * 2.85, -1.05),
      s(0.06, 0.06, 0.06),
    );
    if (i % 2 === 0) {
      builder.tube(
        m.gold,
        [
          p(Math.sin(a - 0.04) * 2.8, 6.5 + Math.cos(a - 0.04) * 2.8, -1.05),
          p(Math.sin(a) * 3.04, 6.5 + Math.cos(a) * 3.04, -1.05),
          p(Math.sin(a + 0.04) * 2.8, 6.5 + Math.cos(a + 0.04) * 2.8, -1.05),
        ],
        0.025 * scale,
        8,
      );
    }
  }
}

export function createSculptures(
  builder: LandBuilder,
  m: PureLandMaterials,
  detail: LandDetail,
): void {
  for (const figure of LAND_STRUCTURE.figures)
    seatedFigure(builder, m, figure.x, figure.z, figure.scale, detail);
}
