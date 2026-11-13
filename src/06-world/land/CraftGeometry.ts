import {
  BufferGeometry,
  CatmullRomCurve3,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  TubeGeometry,
  Vector3,
} from 'three';
import { LAND_CRAFT } from '@/01-shared';

export type FigureProfile = readonly (readonly [number, number, number, number])[];
type Relief = (x: number, y: number) => number;

/** 小倒角只增加一圈边面，不使用高细分的圆角立方体。尺寸表示最终外包围尺寸。 */
export function chamferedBox(
  width: number,
  height: number,
  depth: number,
  bevel: number,
): BufferGeometry {
  const radius = Math.min(bevel, width / 4, height / 4, depth / 4);
  const x = width / 2 - radius,
    y = height / 2 - radius;
  const outline = new Shape();
  outline.moveTo(-x, -y);
  outline.lineTo(x, -y);
  outline.lineTo(x, y);
  outline.lineTo(-x, y);
  outline.closePath();
  const geometry = new ExtrudeGeometry(outline, {
    depth: depth - radius * 2,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelThickness: radius,
    bevelSize: radius,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2 + radius);
  return geometry;
}

/** 按高度插值截面；切线按相邻高度计算，防止不等距轮廓在肩颈处产生折线。 */
export function profileSection(profile: FigureProfile, y: number): [number, number, number] {
  let index = 0;
  while (index < profile.length - 2 && y > profile[index + 1]![0]) index++;
  const a = profile[index]!,
    b = profile[index + 1]!;
  const before = profile[Math.max(0, index - 1)]!,
    after = profile[Math.min(profile.length - 1, index + 2)]!;
  const span = b[0] - a[0],
    t = Math.max(0, Math.min(1, (y - a[0]) / span));
  const t2 = t * t,
    t3 = t2 * t;
  const result: [number, number, number] = [0, 0, 0];
  for (let channel = 1; channel <= 3; channel++) {
    const slopeA = (b[channel]! - before[channel]!) / (b[0] - before[0]);
    const slopeB = (after[channel]! - a[channel]!) / (after[0] - a[0]);
    const value =
      (2 * t3 - 3 * t2 + 1) * a[channel]! +
      (t3 - 2 * t2 + t) * span * slopeA +
      (-2 * t3 + 3 * t2) * b[channel]! +
      (t3 - t2) * span * slopeB;
    result[channel - 1] = Math.max(
      Math.min(a[channel]!, b[channel]!),
      Math.min(Math.max(a[channel]!, b[channel]!), value),
    );
  }
  return result;
}

function gaussian(x: number, y: number): number {
  return Math.exp(-(x * x + y * y));
}

/** 鼻梁、眼窝和嘴唇直接属于头部曲面，避免在脸上另贴球体。 */
export function faceRelief(x: number, y: number): number {
  const { nose, eyes, mouth } = LAND_CRAFT.figure;
  return (
    nose.bridgeDepth * gaussian(x / nose.bridgeWidth, (y - nose.bridgeY) / nose.bridgeHeight) +
    nose.tipDepth * gaussian(x / (nose.bridgeWidth * 1.2), (y - nose.tipY) / 0.11) -
    eyes.depth * gaussian((Math.abs(x) - eyes.x) / eyes.width, (y - eyes.y) / eyes.height) +
    mouth.depth * gaussian(x / mouth.width, (y - mouth.y + 0.045) / mouth.height) +
    mouth.depth * gaussian(x / mouth.width, (y - mouth.y - 0.04) / mouth.height)
  );
}

export function robeRelief(x: number, y: number): number {
  const folds = LAND_CRAFT.figure.folds;
  const bodyWeight = Math.max(0, Math.min(1, (y - 2.4) * 3, (5.8 - y) * 3));
  const kneeWeight = Math.max(0, 1 - Math.abs(y - 2.05) / 0.5);
  return (
    Math.sin(x * folds.frequencyX + y * folds.frequencyY) * folds.amplitude * bodyWeight +
    Math.sin(x * 9 - y * 8) * folds.kneeAmplitude * kneeWeight -
    folds.lapGroove * gaussian(x / 2.2, (y - 2.12 - x * 0.12) / 0.1)
  );
}

export function profileFront(profile: FigureProfile, x: number, y: number, relief: Relief): number {
  const [radius, depth, offset] = profileSection(profile, y);
  const front = Math.sqrt(Math.max(0, 1 - (x / Math.max(radius, 0.001)) ** 2));
  return offset + depth * front + relief(x, y) * front ** 4;
}

/** 索引化的连续椭圆截面，接缝处显式复制顶点以保留纹理 UV。 */
export function profileSurface(
  profile: FigureProfile,
  rows: number,
  segments: number,
  relief: Relief,
): BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const bottom = profile[0]![0],
    top = profile.at(-1)![0];
  for (let row = 0; row <= rows; row++) {
    const y = bottom + ((top - bottom) * row) / rows;
    const [radius, depth, offset] = profileSection(profile, y);
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.sin(angle) * radius,
        front = Math.cos(angle);
      positions.push(
        x,
        y,
        offset + front * depth + (radius > 0 ? relief(x, y) * Math.max(0, front) ** 4 : 0),
      );
      uvs.push(segment / segments, row / rows);
    }
  }
  for (let row = 0; row < rows; row++)
    for (let segment = 0; segment < segments; segment++) {
      const a = row * (segments + 1) + segment,
        b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // UV 接缝保留双份顶点，但法线应相同，否则正面鼻梁与胸口会出现明暗中缝。
  const normals = geometry.getAttribute('normal');
  const normal = new Vector3();
  for (let row = 0; row <= rows; row++) {
    const first = row * (segments + 1),
      last = first + segments;
    if (row === 0 || row === rows) {
      for (let col = first; col <= last; col++) normals.setXYZ(col, 0, row === 0 ? -1 : 1, 0);
    } else {
      normal
        .set(
          normals.getX(first) + normals.getX(last),
          normals.getY(first) + normals.getY(last),
          normals.getZ(first) + normals.getZ(last),
        )
        .normalize();
      normals.setXYZ(first, normal.x, normal.y, normal.z);
      normals.setXYZ(last, normal.x, normal.y, normal.z);
    }
  }
  return geometry;
}

/** 半径与弯曲路径共用弧长参数，适用于连续袖管与从主干收细至枝梢的树枝。 */
export function taperedTube(
  points: readonly (readonly number[])[],
  radii: readonly number[],
  segments: number,
  radial = 12,
): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])));
  const geometry = new TubeGeometry(curve, segments, 1, radial, false);
  const positions = geometry.getAttribute('position');
  const center = new Vector3();
  for (let row = 0; row <= segments; row++) {
    const t = row / segments,
      scaled = t * (radii.length - 1);
    const index = Math.min(radii.length - 2, Math.floor(scaled));
    const fraction = scaled - index;
    const radius = radii[index]! * (1 - fraction) + radii[index + 1]! * fraction;
    curve.getPointAt(t, center);
    for (let col = 0; col <= radial; col++) {
      const i = row * (radial + 1) + col;
      positions.setXYZ(
        i,
        center.x + (positions.getX(i) - center.x) * radius,
        center.y + (positions.getY(i) - center.y) * radius,
        center.z + (positions.getZ(i) - center.z) * radius,
      );
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** 造像保持原接口和默认径向细分。 */
export { taperedTube as taperedSleeve };

/** 金属莲瓣有上下两层与封边，近看不再是消失的单面薄片。 */
export function sculptedPetal(): BufferGeometry {
  const { length, halfWidth, rise, thickness, rows, columns } = LAND_CRAFT.figure.petal;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const layerSize = (rows + 1) * (columns + 1);
  for (let layer = 0; layer < 2; layer++) {
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const width = Math.sin(Math.PI * t) ** 0.75 * halfWidth;
      for (let col = 0; col <= columns; col++) {
        const u = (col / columns) * 2 - 1;
        positions.push(
          u * width,
          rise * t * t + u * u * Math.sin(Math.PI * t) * 0.13 - layer * thickness,
          t * length,
        );
        uvs.push(col / columns, t);
      }
    }
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        const a = layer * layerSize + row * (columns + 1) + col,
          b = a + columns + 1;
        if (layer === 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
  }
  for (let row = 0; row < rows; row++)
    for (const col of [0, columns]) {
      const a = row * (columns + 1) + col,
        b = a + columns + 1;
      if (col === 0) indices.push(a, a + layerSize, b, b, a + layerSize, b + layerSize);
      else indices.push(a, b, a + layerSize, b, b + layerSize, a + layerSize);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
