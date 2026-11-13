import { afterAll, describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { LAND_CRAFT, LAND_DETAIL, LAND_STRUCTURE } from '@/01-shared';
import type { LandDetail } from '@/01-shared';
import type { PureLandMaterials } from '@/05-materials';
import { createArchitecture } from '@/06-world/land/Architecture';
import { LandBuilder } from '@/06-world/land/Builder';
import {
  chamferedBox,
  faceRelief,
  profileSection,
  profileSurface,
  taperedSleeve,
} from '@/06-world/land/CraftGeometry';
import { createRoof, roofGeometry, roofPoint } from '@/06-world/land/Roof';
import { createSculptures } from '@/06-world/land/Sculpture';
import { sampleLandHeight } from '@/07-systems';

/** 几何与射线测试只需要材质身份，不依赖 Canvas/WebGL。 */
function materialFixture(): PureLandMaterials {
  return {
    stone: new MeshStandardMaterial(),
    carvedStone: new MeshStandardMaterial(),
    gold: new MeshStandardMaterial(),
    goldDark: new MeshStandardMaterial(),
    sculpture: new MeshStandardMaterial(),
    sculptureFold: new MeshStandardMaterial(),
    jade: new MeshStandardMaterial(),
    roof: new MeshStandardMaterial(),
    tileEnd: new MeshStandardMaterial(),
    frieze: new MeshStandardMaterial(),
    wood: new MeshStandardMaterial(),
    dark: new MeshStandardMaterial(),
    pearl: new MeshStandardMaterial(),
    glow: new MeshBasicMaterial(),
    leaf: new MeshStandardMaterial(),
    lily: new MeshStandardMaterial(),
    lotus: [],
  };
}

function geometryStats(root: Group) {
  let triangles = 0,
    vertices = 0,
    bytes = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry: BufferGeometry = object.geometry;
    vertices += geometry.getAttribute('position').count;
    triangles += geometry.index!.count / 3;
    bytes += geometry.index!.array.byteLength;
    for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  });
  return { triangles, vertices, bytes };
}

function dispose(root: Group): void {
  root.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
}

describe('建筑与造像连续几何', () => {
  it('倒角保留外尺寸，最薄一级踏步不会被 bevel 放大', () => {
    const geometry = chamferedBox(18, 1 / 6, 0.75, 0.025);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(18, 5);
    expect(size.y).toBeCloseTo(1 / 6, 5);
    expect(size.z).toBeCloseTo(0.75, 5);
    geometry.dispose();
  });

  it('四条屋角接缝在整个坡面连续，所有细节级别的顶面法线向上', () => {
    for (let step = 0; step <= 30; step++) {
      const t = step / 30;
      for (const x of [-1, 1])
        for (const z of [-1, 1]) {
          const front = roofPoint(x, t, z === 1 ? 0 : 1, 47, 32, 7.14);
          const side = roofPoint(z, t, x === 1 ? 2 : 3, 47, 32, 7.14);
          expect(front.distanceTo(side)).toBeLessThan(1e-10);
        }
    }
    for (const detail of ['near', 'middle', 'far'] as const) {
      const geometry = roofGeometry(
        { x: 0, z: 0, width: 47, depth: 32, base: 0, height: 7.14 },
        detail,
      );
      const normals = geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThanOrEqual(0);
      geometry.dispose();
    }
  });

  it('连续头部闭合两端，UV 接缝法线一致，面部朝外', () => {
    const { figureRows: rows, figureSegments: segments } = LAND_DETAIL.near;
    const profile = LAND_CRAFT.figure.head;
    const geometry = profileSurface(profile, rows, segments, faceRelief);
    const positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal');
    const start = new Vector3(),
      end = new Vector3();
    for (let row = 0; row <= rows; row++) {
      const first = row * (segments + 1),
        last = first + segments;
      expect(
        start
          .fromBufferAttribute(positions, first)
          .distanceTo(end.fromBufferAttribute(positions, last)),
      ).toBeLessThan(1e-6);
      expect(
        start
          .fromBufferAttribute(normals, first)
          .distanceTo(end.fromBufferAttribute(normals, last)),
      ).toBeLessThan(1e-6);
      if (row > rows / 4 && row < (rows * 3) / 4) expect(normals.getZ(first)).toBeGreaterThan(0);
    }
    for (const row of [0, rows])
      for (let col = 1; col <= segments; col++) {
        const first = row * (segments + 1);
        expect(
          start
            .fromBufferAttribute(positions, first)
            .distanceTo(end.fromBufferAttribute(positions, first + col)),
        ).toBeLessThan(1e-6);
      }
    geometry.dispose();
  });

  it('袖根完整藏入肩部，端环不会暴露成断开的管口', () => {
    const craft = LAND_CRAFT.figure;
    const geometry = taperedSleeve(craft.arm, craft.armRadii, LAND_DETAIL.near.figureRows);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i <= 12; i++) {
      const [width, depth, z] = profileSection(craft.robe, positions.getY(i));
      const ellipticalRadius =
        (positions.getX(i) / width) ** 2 + ((positions.getZ(i) - z) / depth) ** 2;
      expect(ellipticalRadius).toBeLessThan(1);
    }
    geometry.dispose();
  });
});

describe('建筑与导航共同尺寸', () => {
  const materials = materialFixture(),
    plaque = new MeshStandardMaterial(),
    root = new Group();
  const builder = new LandBuilder();
  createArchitecture(builder, materials, plaque, 'near');
  builder.flush(root);
  root.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  const heightAt = (x: number, z: number): number => {
    ray.ray.origin.set(x, LAND_STRUCTURE.hall.base + 0.15, z);
    return ray.intersectObject(root, true)[0]!.point.y;
  };
  afterAll(() => {
    dispose(root);
    plaque.dispose();
    for (const material of Object.values(materials))
      if (!Array.isArray(material)) material.dispose();
  });

  it('每级台阶实体顶面递增，最后一级与主殿台面接平，导航坡度误差不到一级', () => {
    const { stairs, hall, courtHeight } = LAND_STRUCTURE;
    const run = (stairs.frontZ - stairs.backZ) / stairs.count,
      rise = (hall.base - courtHeight) / stairs.count;
    for (let step = 0; step < stairs.count; step++) {
      const z = stairs.frontZ - (step + 0.5) * run;
      const physical = heightAt(stairs.x, z);
      expect(physical).toBeCloseTo(courtHeight + (step + 1) * rise, 5);
      expect(Math.abs(physical - sampleLandHeight(stairs.x, z)!)).toBeLessThan(rise);
    }
    for (const z of [stairs.backZ - 0.03, -34, -40, -46]) {
      expect(heightAt(stairs.x, z)).toBeCloseTo(hall.base, 5);
      expect(sampleLandHeight(stairs.x, z)).toBeCloseTo(hall.base, 5);
    }
  });

  it('柱础方形角部也被导航阻挡，中央开间可正常通行', () => {
    const { hall, columns, navigation } = LAND_STRUCTURE;
    const halfWidth = (hall.width * columns.radiusRatio * LAND_CRAFT.column.footWidthRatio) / 2;
    const columnX = (3 / (columns.hallCount - 1) - 0.5) * (hall.width - columns.insetX * 2);
    const columnZ = hall.z + hall.depth / 2 - columns.insetZ;
    expect(sampleLandHeight(columnX + halfWidth - 0.05, columnZ + halfWidth - 0.05)).toBeNull();
    expect(sampleLandHeight(columnX + halfWidth + navigation.bodyRadius + 0.05, columnZ)).toBe(
      hall.base,
    );
    expect(sampleLandHeight(0, columnZ)).toBe(hall.base);
  });

  it('柱廊地面只出现一层台面，没有共面的金属盖板', () => {
    ray.ray.origin.set(8, LAND_STRUCTURE.hall.base + 0.15, -41);
    const hits = ray
      .intersectObject(root, true)
      .filter((hit) => Math.abs(hit.point.y - LAND_STRUCTURE.hall.base) < 0.001);
    expect(hits).toHaveLength(1);
    expect((hits[0]!.object as Mesh).material).toBe(materials.stone);
  });
});

describe('资产细节预算', () => {
  it('建筑和造像三个等级严格递减，near 留在 P1 全场静态三角形预算以内', () => {
    const materials = materialFixture(),
      plaque = new MeshStandardMaterial();
    const totals: { triangles: number; bytes: number; vertices: number }[] = [];
    const assets = [];
    for (const detail of ['near', 'middle', 'far'] satisfies LandDetail[]) {
      const root = new Group(),
        builder = new LandBuilder();
      createArchitecture(builder, materials, plaque, detail);
      builder.flush(root);
      const architecture = geometryStats(root);
      const figureRoot = new Group(),
        figureBuilder = new LandBuilder();
      createSculptures(figureBuilder, materials, detail);
      figureBuilder.flush(figureRoot);
      const figures = geometryStats(figureRoot);
      const roofRoot = new Group(),
        roofBuilder = new LandBuilder();
      createRoof(
        roofBuilder,
        materials,
        { x: 0, z: 0, width: 47, depth: 32, base: 0, height: 7.14 },
        detail,
      );
      roofBuilder.flush(roofRoot);
      assets.push({ detail, architecture, figures, hallRoof: geometryStats(roofRoot) });
      dispose(roofRoot);
      root.add(figureRoot);
      const geometries: BufferGeometry[] = [];
      root.traverse((object) => {
        if (object instanceof Mesh) geometries.push(object.geometry);
      });
      for (const geometry of geometries) {
        expect(geometry.index).not.toBeNull();
        expect(geometry.boundingSphere!.radius).toBeLessThan(Infinity);
      }
      totals.push(geometryStats(root));
      dispose(root);
    }
    expect(totals[0]!.triangles).toBeLessThan(1_056_246);
    expect(totals[1]!.triangles).toBeLessThan(totals[0]!.triangles);
    expect(totals[2]!.triangles).toBeLessThan(totals[1]!.triangles);
    expect(totals[1]!.bytes).toBeLessThan(totals[0]!.bytes);
    // 可选输出供实施文档引用，普通测试不写文件或产生采样噪声。
    if (process.env.LAND_ASSET_REPORT === '1') console.info(JSON.stringify({ assets }, null, 2));
    plaque.dispose();
    for (const material of Object.values(materials))
      if (!Array.isArray(material)) material.dispose();
  });
});
