import { LatheGeometry, Vector2 } from 'three';
import type { PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';
import { petalGeometry } from './Garden';

/** 造像采用连续衣褶轮廓、叠腿、面部与发髻；所有形体为静态建筑陈设。 */
function seatedFigure(
  builder: LandBuilder,
  m: PureLandMaterials,
  x: number,
  z: number,
  scale: number,
): void {
  const base = 3.3;
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
  builder.cylinder(m.goldDark, p(0, 0.5, 0), 3.6 * scale, scale);
  builder.cylinder(m.gold, p(0, 1, 0), 3.2 * scale, 0.28 * scale);
  const petal = petalGeometry();
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 24; i++) {
      const angle = ((i + ring * 0.5) / 24) * Math.PI * 2;
      const radius = 1.2 + ring * 0.3;
      builder.shape(
        petal,
        m.gold,
        p(Math.sin(angle) * radius, 0.85 + ring * 0.35, Math.cos(angle) * radius),
        s(1.25, 1.1, 1.7),
        angle,
      );
    }
  }
  petal.dispose();
  builder.sphere(body, p(-1.2, 2, 0.6), s(1.9, 0.75, 1.45));
  builder.sphere(body, p(1.2, 2, 0.6), s(1.9, 0.75, 1.45));
  const points = [
    [2.1, 1.9],
    [2, 2.5],
    [1.52, 3.3],
    [1.4, 4.6],
    [1.78, 5.35],
    [1.5, 5.8],
    [0.72, 6.1],
    [0.59, 6.35],
  ].map(([r, y]) => new Vector2(r!, y!));
  const robe = new LatheGeometry(points, 48);
  builder.shape(robe, body, p(0, 0, 0), s(1, 1, 0.7));
  robe.dispose();
  builder.sphere(body, p(0, 7, 0), s(0.86, 1.22, 0.82));
  builder.sphere(body, p(0, 6.25, 0), s(0.54, 0.75, 0.51));
  builder.sphere(m.dark, p(0, 7.82, -0.12), s(1, 0.56, 0.81));
  builder.sphere(m.dark, p(0, 8.35, -0.1), s(0.43, 0.48, 0.4));
  for (let row = 0; row < 5; row++)
    for (let curl = 0; curl < 18; curl++) {
      const angle = ((curl + row * 0.5) / 18) * Math.PI * 2;
      const radius = 0.97 * Math.cos(((row / 6) * Math.PI) / 2);
      builder.sphere(
        m.goldDark,
        p(Math.sin(angle) * radius, 7.65 + row * 0.16, Math.cos(angle) * radius * 0.83 - 0.12),
        s(0.11, 0.1, 0.11),
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
  for (const side of [-1, 1]) {
    builder.sphere(body, p(side * 0.87, 6.9, 0), s(0.2, 0.62, 0.26));
    builder.sphere(body, p(side * 1.32, 4.25, 0.19), s(0.58, 1.15, 0.65));
    builder.tube(
      body,
      [
        p(side * 1.35, 5.5, 0),
        p(side * 1.9, 4.5, 0.2),
        p(side * 1.7, 3.3, 0.7),
        p(side * 0.55, 3.05, 1.08),
      ],
      0.43 * scale,
      14,
    );
    builder.sphere(body, p(side * 0.34, 3.05, 1.1), s(0.65, 0.18, 0.35));
    for (let finger = 0; finger < 4; finger++) {
      builder.tube(
        body,
        [
          p(side * 0.42, 3.12, 0.95 + finger * 0.13),
          p(side * 0.13, 3.12, 0.95 + finger * 0.13),
          p(-side * 0.1, 3.08, 0.94 + finger * 0.13),
        ],
        0.055 * scale,
        7,
      );
    }
    builder.tube(
      m.goldDark,
      [p(side * 0.62, 7.14, 0.64), p(side * 0.38, 7.1, 0.79), p(side * 0.16, 7.14, 0.73)],
      0.024 * scale,
      8,
    );
    builder.tube(
      m.goldDark,
      [p(side * 0.61, 7.38, 0.65), p(side * 0.36, 7.43, 0.78), p(side * 0.16, 7.36, 0.75)],
      0.03 * scale,
      8,
    );
  }
  builder.sphere(body, p(0, 6.94, 0.78), s(0.13, 0.28, 0.18));
  builder.tube(
    m.goldDark,
    [p(-0.25, 6.58, 0.72), p(0, 6.54, 0.78), p(0.25, 6.58, 0.72)],
    0.025 * scale,
    10,
  );
  builder.sphere(m.pearl, p(0, 7.48, 0.78), s(0.075, 0.075, 0.06));
  // 衣褶沿胸前斜落，显露雕刻层次；轮廓与躯干共享缩放。
  for (let i = 0; i < 8; i++) {
    builder.tube(
      m.sculptureFold,
      [
        p(-1.25 + i * 0.14, 5.45, 0.55),
        p(-0.7 + i * 0.18, 4.4, 1.04),
        p(0.5 + i * 0.16, 2.9, 1.22),
      ],
      0.035 * scale,
      14,
    );
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

export function createSculptures(builder: LandBuilder, m: PureLandMaterials): void {
  seatedFigure(builder, m, 0, -55, 1.5);
  seatedFigure(builder, m, -11, -55, 1.03);
  seatedFigure(builder, m, 11, -55, 1.03);
}
