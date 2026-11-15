import { describe, expect, it, vi } from 'vitest';
import {
  BufferGeometry,
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
  it('按显式世界原点生成稳定 48m cell 索引', () => {
    const builder = new LandBuilder({ cellSize: 48, cellOrigin: [-360, -360] });
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const box = new BoxGeometry(1, 1, 1);
    builder.shape(box, material, [-348, 0, -348]);
    builder.shape(box, material, [-300, 0, -348]);
    builder.flush(parent);
    expect(parent.children.map(({ userData }) => userData['cell'])).toEqual(['0,0', '1,0']);
    for (const child of parent.children) (child as Mesh).geometry.dispose();
    box.dispose();
    material.dispose();
  });

  it('用缩放旋转后的几何包围盒中心分配 cell，且不变换调用方几何', () => {
    const builder = new LandBuilder({ cellSize: 10, cellOrigin: [0, 0] });
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const geometry = new BoxGeometry(2, 2, 2);
    geometry.translate(1, 0, 0);
    const originalPosition = geometry.getAttribute('position').array.slice();

    builder.shape(geometry, material, [9, 0, 0], [2, 1, 1], Math.PI / 2);
    builder.flush(parent);

    expect(parent.children.map(({ userData }) => userData['cell'])).toEqual(['0,-1']);
    expect(geometry.getAttribute('position').array).toEqual(originalPosition);
    expect(geometry.boundingBox).toBeNull();
    const mesh = output(parent);
    expect(mesh.geometry.boundingBox).not.toBeNull();
    expect(mesh.geometry.boundingSphere).not.toBeNull();
    mesh.geometry.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('取消时释放尚未合批的副本，但保留调用方几何与材质', () => {
    const builder = new LandBuilder();
    const material = new MeshStandardMaterial();
    const source = new BoxGeometry();
    const pending = source.clone();
    const pendingDispose = vi.spyOn(pending, 'dispose');
    const sourceDispose = vi.spyOn(source, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    vi.spyOn(source, 'clone').mockReturnValue(pending);

    builder.shape(source, material);
    builder.abort();
    builder.abort();

    expect(pendingDispose).toHaveBeenCalledTimes(1);
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    source.dispose();
    material.dispose();
  });

  it('取消时释放已合批但尚未挂载的 LOD 几何，且共享阴影副本只释放一次', () => {
    const builder = new LandBuilder({ dynamicLod: true });
    const material = new MeshStandardMaterial();
    const disposed = new Set<BufferGeometry>();
    const dispose = BufferGeometry.prototype.dispose;
    const disposeSpy = vi.spyOn(BufferGeometry.prototype, 'dispose').mockImplementation(function (
      this: BufferGeometry,
    ) {
      disposed.add(this);
      return dispose.call(this);
    });

    try {
      expect(
        builder.lod([0, 0, 0], 1, 'roof', 'near', (level) => {
          level.box(material, [0, 0, 0], [1, 1, 1]);
        }),
      ).toBe(true);

      builder.abort();

      // 每级各有模板、合并输入和输出；中档输出还被阴影组共享。
      expect(disposed.size).toBe(9);
      expect(disposeSpy).toHaveBeenCalledTimes(9);
    } finally {
      disposeSpy.mockRestore();
      material.dispose();
    }
  });

  it('取消分段 flush 时释放未挂载的已合批 cell 与剩余输入', () => {
    const builder = new LandBuilder({ cellSize: 10 });
    const parent = new Group();
    const material = new MeshStandardMaterial();
    const source = new BoxGeometry();
    const copies: BufferGeometry[] = [];
    const clone = source.clone;
    vi.spyOn(source, 'clone').mockImplementation(function (this: BoxGeometry) {
      const copy = clone.call(this);
      copies.push(copy);
      return copy;
    });
    const disposed = new Set<BufferGeometry>();
    const dispose = BufferGeometry.prototype.dispose;
    const disposeSpy = vi.spyOn(BufferGeometry.prototype, 'dispose').mockImplementation(function (
      this: BufferGeometry,
    ) {
      disposed.add(this);
      return dispose.call(this);
    });

    try {
      builder.shape(source, material, [0, 0, 0]);
      builder.shape(source, material, [20, 0, 0]);

      const steps = builder.flushSteps(parent);
      expect(steps.next().done).toBe(false);
      expect(disposed.has(copies[0]!)).toBe(true);
      expect(disposed.has(copies[1]!)).toBe(false);
      steps.return();

      expect(parent.children).toHaveLength(0);
      expect(disposed.size).toBe(3);
      expect(disposed.has(copies[0]!)).toBe(true);
      expect(disposed.has(copies[1]!)).toBe(true);
    } finally {
      disposeSpy.mockRestore();
      source.dispose();
      material.dispose();
    }
  });

  it('lodSteps 与同步 LOD 输出逐属性一致', () => {
    const options = { cellSize: 10, dynamicLod: true };
    const synchronous = new LandBuilder(options);
    const incremental = new LandBuilder(options);
    const synchronousRoot = new Group();
    const incrementalRoot = new Group();
    const material = new MeshStandardMaterial();
    const build = (builder: LandBuilder): void => {
      builder.box(material, [7, 2, -3], [4, 5, 6], 0.4);
      builder.box(material, [17, 2, -3], [2, 3, 4]);
    };

    synchronous.lod([4, 2, -3], 5, 'roof', 'near', build);
    const steps = incremental.lodSteps([4, 2, -3], 5, 'roof', 'near', function* (builder) {
      build(builder);
      yield;
    });
    let result = steps.next();
    while (!result.done) result = steps.next();
    expect(result.value).toBe(true);

    synchronous.flush(synchronousRoot);
    incremental.flush(incrementalRoot);

    const snapshot = (root: Group) => {
      const meshes: unknown[] = [];
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        meshes.push({
          name: object.name,
          cell: object.userData['cell'],
          position: Array.from(object.geometry.getAttribute('position').array),
          index: object.geometry.index ? Array.from(object.geometry.index.array) : null,
        });
      });
      return meshes;
    };
    expect(snapshot(incrementalRoot)).toEqual(snapshot(synchronousRoot));

    for (const root of [synchronousRoot, incrementalRoot]) {
      const geometries = new Set<BufferGeometry>();
      root.traverse((object) => {
        if (object instanceof Mesh) geometries.add(object.geometry);
      });
      for (const geometry of geometries) geometry.dispose();
    }
    material.dispose();
  });

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
