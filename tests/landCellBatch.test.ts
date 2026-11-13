import { describe, expect, it, vi } from 'vitest';
import {
  BatchedMesh,
  Frustum,
  Group,
  Matrix4,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from 'three';
import type { BufferGeometry, Material, Mesh, WebGLRenderer } from 'three';
import { disposeObjectTree } from '@/04-engine/SceneContext';
import { LandBuilder } from '@/06-world/land/Builder';
import { batchStaticCells } from '@/06-world/land/CellBatch';

function build(multiDraw: boolean, material: Material, lod = false): Scene {
  const scene = new Scene(),
    root = new Group(),
    builder = new LandBuilder({ cellSize: 48, dynamicLod: lod, multiDraw });
  for (const x of [-160, -50, 0, 50, 160]) {
    builder.box(material, [x, 0, -20], [4, 7, 9], 0.7);
    builder.sphere(material, [x, 2, -20], [3, 2, 4]);
  }
  if (lod)
    builder.lod([0, 0, 0], 10, 'roof', 'near', (child) => {
      child.box(material, [0, 10, 0], [8, 2, 8]);
    });
  builder.flush(root);
  scene.add(root);
  scene.updateMatrixWorld(true);
  return scene;
}

function getBatch(scene: Scene): BatchedMesh {
  const object = scene.children[0]!.children[0];
  if (!(object instanceof BatchedMesh)) throw new Error('缺少区块批次');
  return object;
}

describe('静态区块 multi-draw', () => {
  it('逐区块的全部三角形属性及包围球等价，实例保持单位阵', () => {
    const material = new MeshStandardMaterial(),
      baseline = build(false, material),
      candidate = build(true, material),
      batch = getBatch(candidate);
    let vertexStart = 0,
      indexStart = 0;
    baseline.children[0]!.children.forEach((object, id) => {
      const mesh = object as Mesh;
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        const actual = batch.geometry.getAttribute(name);
        expect(
          actual.array.slice(
            vertexStart * attribute.itemSize,
            (vertexStart + attribute.count) * attribute.itemSize,
          ),
        ).toEqual(attribute.array);
      }
      const index = mesh.geometry.index!;
      for (let i = 0; i < index.count; i++)
        expect(batch.geometry.index!.getX(indexStart + i) - vertexStart).toBe(index.getX(i));
      expect(batch.getMatrixAt(id, new Matrix4())).toEqual(new Matrix4());
      expect(batch.getBoundingSphereAt(id, mesh.geometry.boundingSphere!.clone())).toEqual(
        mesh.geometry.boundingSphere,
      );
      vertexStart += mesh.geometry.getAttribute('position').count;
      indexStart += index.count;
    });
    expect(batch.geometry.index!.count).toBe(indexStart);
    expect(batch.geometry.getAttribute('position').count).toBe(vertexStart);
    expect(batch.layers.mask).toBe(7);
    expect(batch.castShadow && batch.receiveShadow).toBe(true);
    expect(batch.sortObjects).toBe(false);
    disposeObjectTree(baseline);
    disposeObjectTree(candidate);
  });

  it('主/倒影/阴影交替绘制时各自裁剪，保留原顺序和可见三角形', () => {
    const material = new MeshStandardMaterial(),
      baseline = build(false, material),
      candidate = build(true, material),
      batch = getBatch(candidate),
      main = new PerspectiveCamera(50, 1.6, 0.1, 400),
      reflection = new PerspectiveCamera(50, 1.6, 0.1, 400),
      shadow = new OrthographicCamera(-90, 90, 90, -90, 0.1, 400);
    main.position.set(-80, 30, 80);
    main.lookAt(-80, 0, -20);
    reflection.position.set(90, -20, 80);
    reflection.lookAt(90, 0, -20);
    shadow.position.set(0, 160, 10);
    shadow.lookAt(0, 0, -20);
    const sequences: number[][] = [];
    for (const camera of [main, reflection, shadow, main]) {
      camera.updateMatrixWorld(true);
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      const expected = baseline.children[0]!.children.map((mesh, id) => ({
        mesh: mesh as Mesh,
        id,
      })).filter(({ mesh }) => frustum.intersectsObject(mesh));
      if (camera === shadow)
        batch.onBeforeShadow(
          {} as WebGLRenderer,
          candidate,
          main,
          shadow,
          batch.geometry,
          material,
          null!,
        );
      else
        batch.onBeforeRender(
          {} as WebGLRenderer,
          candidate,
          camera,
          batch.geometry,
          material,
          null!,
        );
      // Three.js 没有公开的可见范围读取 API；这里仅在测试读取实际提交表。
      const internals = batch as unknown as {
        _multiDrawCount: number;
        _multiDrawCounts: Int32Array;
        _indirectTexture: { image: { data: Uint32Array } };
      };
      const ids = Array.from(
        internals._indirectTexture.image.data.slice(0, internals._multiDrawCount),
      );
      expect(ids).toEqual(expected.map(({ id }) => id));
      expect(Array.from(internals._multiDrawCounts.slice(0, internals._multiDrawCount))).toEqual(
        expected.map(({ mesh }) => mesh.geometry.index!.count),
      );
      sequences.push(ids);
    }
    expect(sequences[0]).not.toEqual(sequences[1]);
    expect(sequences[0]).toEqual(sequences[3]);
    disposeObjectTree(baseline);
    disposeObjectTree(candidate);
  });

  it('超过 65535 顶点的跨区块索引保持尾部几何', () => {
    const scene = new Scene(),
      root = new Group(),
      material = new MeshStandardMaterial();
    const geometry = new SphereGeometry(1, 128, 96),
      builder = new LandBuilder({ cellSize: 48, multiDraw: true });
    for (let i = 0; i < 6; i++) builder.shape(geometry, material, [i * 60, 0, 0]);
    builder.flush(root);
    scene.add(root);
    const batch = getBatch(scene),
      index = batch.geometry.index!;
    expect(index.array).toBeInstanceOf(Uint32Array);
    expect(index.getX(index.count - 1)).toBe(
      geometry.index!.getX(geometry.index!.count - 1) + geometry.getAttribute('position').count * 5,
    );
    geometry.dispose();
    disposeObjectTree(scene);
  });

  it('能力关闭及透明材质走原区块路径，不兼容属性不静默丢失', () => {
    const material = new MeshStandardMaterial(),
      fallback = build(false, material);
    expect(fallback.children[0]!.children).toHaveLength(5);
    expect(fallback.children[0]!.children.every((mesh) => !(mesh instanceof BatchedMesh))).toBe(
      true,
    );
    const transparent = build(true, new MeshStandardMaterial({ transparent: true }));
    expect(transparent.children[0]!.children).toHaveLength(5);
    const meshes = fallback.children[0]!.children as Mesh<BufferGeometry, Material>[];
    meshes[1]!.geometry.deleteAttribute('uv');
    expect(batchStaticCells(meshes)).toBeNull();
    disposeObjectTree(fallback);
    disposeObjectTree(transparent);
  });

  it('LOD/共享阴影不进入批次，专属几何、批纹理及共享材质各释放一次', () => {
    const material = new MeshStandardMaterial(),
      scene = build(true, material, true),
      batch = getBatch(scene);
    const lod = scene.children[0]!.children.find((object) => object.name === 'land-distance-lod')!;
    const middle = lod.children[1]!.children[0] as Mesh;
    const shadow = scene.children[0]!.children[2]!.children[0] as Mesh;
    expect(shadow.geometry).toBe(middle.geometry);
    lod.traverse((object) => expect(object instanceof BatchedMesh).toBe(false));
    const internals = batch as unknown as {
      _matricesTexture: { dispose(): void };
      _indirectTexture: { dispose(): void };
    };
    const spies = [
      batch.geometry,
      middle.geometry,
      material,
      internals._matricesTexture,
      internals._indirectTexture,
    ].map((resource) => vi.spyOn(resource, 'dispose'));
    disposeObjectTree(scene);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
