import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  CatmullRomCurve3,
  TubeGeometry,
} from 'three';
import type { BufferGeometry } from 'three';
import { LandBuilder } from '@/06-world/land/Builder';

function output(parent: Group): Mesh {
  const mesh = parent.children[0];
  if (!(mesh instanceof Mesh)) throw new Error('没有生成静态批次');
  return mesh;
}

function geometryBytes(geometry: BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  return bytes;
}

describe('LandBuilder 索引合批', () => {
  it('平移曲线复用完整网格，位置误差小于 0.1 毫米，法线和三角形不变', () => {
    const builder = new LandBuilder(),
      root = new Group(),
      material = new MeshStandardMaterial();
    const points = [
      [10, 2, -35],
      [12, 2.4, -38],
      [14, 4, -41],
    ] as const;
    const translated = points.map((p) => [p[0] + 126, p[1], p[2]] as const);
    builder.tube(material, points, 0.075, 10);
    builder.tube(material, translated, 0.075, 10);
    builder.flush(root);
    expect(builder.cacheStats.hits).toBe(1);
    const actual = output(root).geometry;
    const expected = new TubeGeometry(
      new CatmullRomCurve3(points.map((p) => new Vector3(...p))),
      10,
      0.075,
      5,
      false,
    );
    expect(actual.index!.count).toBe(expected.index!.count * 2);
    for (const attribute of ['position', 'normal', 'uv']) {
      const a = actual.getAttribute(attribute),
        e = expected.getAttribute(attribute);
      for (let i = 0; i < e.array.length; i++)
        expect(Math.abs(a.array[i]! - e.array[i]!)).toBeLessThan(0.0001);
    }
    actual.dispose();
    expected.dispose();
    material.dispose();
  });
  it('不同形状、缩放和旋转合批后逐三角形位置/法线/UV 等价，保留接缝', () => {
    const builder = new LandBuilder();
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const box = new BoxGeometry(1, 1, 1);
    const sphere = new SphereGeometry(1, 16, 12);
    const originalPosition = box.getAttribute('position').array.slice();
    const sourceDisposed = vi.fn();
    box.addEventListener('dispose', sourceDisposed);
    builder.shape(box, material, [3, 2, -4], [2, 1, 0.5], 0.7);
    builder.shape(sphere, material, [-2, 4, 1], [1, 2, 1]);
    builder.flush(parent);

    const matrix = new Matrix4().compose(
      new Vector3(3, 2, -4),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
      new Vector3(2, 1, 0.5),
    );
    const expectedBox = box.clone().applyMatrix4(matrix).toNonIndexed();
    const expectedSphere = sphere.clone().scale(1, 2, 1).translate(-2, 4, 1).toNonIndexed();
    const geometry = output(parent).geometry;
    const expanded = geometry.toNonIndexed();
    for (const name of ['position', 'normal', 'uv']) {
      expect(Array.from(expanded.getAttribute(name).array)).toEqual([
        ...expectedBox.getAttribute(name).array,
        ...expectedSphere.getAttribute(name).array,
      ]);
    }
    expect(geometry.getAttribute('position').count).toBe(
      box.getAttribute('position').count + sphere.getAttribute('position').count,
    );
    expect(box.getAttribute('position').array).toEqual(originalPosition);
    expect(sourceDisposed).not.toHaveBeenCalled();
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
    for (const item of [box, sphere, expectedBox, expectedSphere, expanded, geometry])
      item.dispose();
    material.dispose();
  });

  it('混入非索引构件时补顺序索引且不修改调用方几何', () => {
    const builder = new LandBuilder();
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const indexed = new PlaneGeometry(2, 2);
    const plain = indexed.toNonIndexed();
    builder.shape(indexed, material);
    builder.shape(plain, material, [0, 0, -1]);
    builder.flush(parent);
    const geometry = output(parent).geometry;
    expect(geometry.index?.count).toBe(indexed.index!.count + plain.getAttribute('position').count);
    expect(geometry.getAttribute('position').count).toBe(10);
    expect(plain.index).toBeNull();
    const expanded = geometry.toNonIndexed();
    expect(Array.from(expanded.getAttribute('uv').array)).toEqual([
      ...plain.getAttribute('uv').array,
      ...plain.getAttribute('uv').array,
    ]);
    for (const item of [indexed, plain, geometry, expanded]) item.dispose();
    material.dispose();
  });

  it('大批次自动提升为 32 位索引，尾部三角形不会溢出回到前部', () => {
    const builder = new LandBuilder();
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const sphere = new SphereGeometry(1, 128, 256);
    builder.shape(sphere, material);
    builder.shape(sphere, material, [10, 0, 0]);
    builder.flush(parent);
    const geometry = output(parent).geometry;
    const index = geometry.index!;
    expect(index.array).toBeInstanceOf(Uint32Array);
    expect(index.count).toBe(sphere.index!.count * 2);
    expect(index.getX(index.count - 1)).toBe(
      sphere.index!.getX(sphere.index!.count - 1) + sphere.getAttribute('position').count,
    );
    expect(index.getX(index.count - 1)).toBeGreaterThan(65535);
    sphere.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('高重复曲面保留全部三角形，同时将缓冲降到展开方案的一半以下', () => {
    const builder = new LandBuilder();
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const sphere = new SphereGeometry(1, 16, 12);
    for (let i = 0; i < 64; i++) builder.shape(sphere, material, [i * 2, 0, 0]);
    builder.flush(parent);
    const geometry = output(parent).geometry;
    const expanded = geometry.toNonIndexed();
    expect(geometry.index?.count).toBe(sphere.index!.count * 64);
    expect(geometryBytes(geometry)).toBeLessThan(geometryBytes(expanded) * 0.5);
    sphere.dispose();
    geometry.dispose();
    expanded.dispose();
    material.dispose();
  });

  it('不兼容属性显式报错，避免成功启动却静默丢掉建筑', () => {
    const builder = new LandBuilder();
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const box = new BoxGeometry();
    const missingUv = new BoxGeometry();
    missingUv.deleteAttribute('uv');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      builder.shape(box, material);
      builder.shape(missingUv, material);
      expect(() => builder.flush(parent)).toThrow('静态构件合批失败');
      expect(parent.children).toHaveLength(0);
    } finally {
      error.mockRestore();
      box.dispose();
      missingUv.dispose();
      material.dispose();
    }
  });
});
