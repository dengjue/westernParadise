import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
} from 'three';
import { LAND_RENDER } from '@/01-shared';
import { DistanceLod } from '@/04-engine';
import { disposeObjectTree } from '@/04-engine/SceneContext';
import { LandBuilder } from '@/06-world/land/Builder';

describe('空间批次与相机独立分级', () => {
  it('固定远景资产回归空间批次，多个资产共用一次提交且完整保留阴影层', () => {
    const root = new Group(),
      material = new MeshBasicMaterial();
    const builder = new LandBuilder({ dynamicLod: true, cellSize: 48 });
    for (const x of [4, 8, 12])
      builder.lod([x, 0, -10], 2, 'roof', 'far', (child) =>
        child.box(material, [x, 0, -10], [2, 2, 2]),
      );
    builder.flush(root);
    expect(root.children).toHaveLength(1);
    const mesh = root.children[0] as Mesh;
    expect(mesh.geometry.index!.count / 3).toBe(36);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.layers.isEnabled(LAND_RENDER.layers.reflection)).toBe(true);
    expect(mesh.layers.isEnabled(LAND_RENDER.layers.shadow)).toBe(true);
    mesh.geometry.dispose();
    material.dispose();
  });

  it.each([24, 48])(
    '%d 米分块保留跨边界构件全部顶点与包围体，视锥裁掉远区不裁掉交界构件',
    (cellSize) => {
      const root = new Group(),
        builder = new LandBuilder({ cellSize }),
        material = new MeshBasicMaterial();
      builder.box(material, [cellSize - 1, 0, -10], [10, 2, 2]);
      builder.box(material, [cellSize * 10, 0, -10], [4, 2, 2]);
      builder.flush(root);
      root.updateMatrixWorld(true);
      const meshes = root.children as Mesh[];
      expect(meshes).toHaveLength(2);
      expect(meshes.reduce((sum, mesh) => sum + mesh.geometry.index!.count / 3, 0)).toBe(24);
      expect(meshes[0]!.geometry.boundingBox!.max.x).toBe(cellSize + 4);
      const camera = new PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(cellSize + 3, 0, 0);
      camera.updateMatrixWorld(true);
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      expect(frustum.intersectsObject(meshes[0]!)).toBe(true);
      expect(frustum.intersectsObject(meshes[1]!)).toBe(false);
      for (const mesh of meshes) mesh.geometry.dispose();
      material.dispose();
    },
  );

  it('真实资产构建器近景保全，主视图与倒影有独立滞回，阴影副本不受可见性切换影响', () => {
    const root = new Group(),
      builder = new LandBuilder({ dynamicLod: true }),
      material = new MeshBasicMaterial();
    builder.lod([12, 0, -10], 5, 'roof', 'near', (level, detail) => {
      level.box(material, [12, 0, -10], [10, 2, 2]);
      if (detail === 'near') level.sphere(material, [12, 2, -10], [1, 1, 1]);
    });
    builder.flush(root);
    root.updateMatrixWorld(true);
    const lod = root.children.find((object) => object instanceof DistanceLod) as DistanceLod;
    // WebGLRenderer 的 isGroup 分支先于 isLOD，不能用 Group 冒充可自动更新的 LOD。
    expect('isGroup' in lod).toBe(false);
    const main = new PerspectiveCamera(),
      reflection = new PerspectiveCamera();
    reflection.layers.set(LAND_RENDER.layers.reflection);
    main.position.set(12, 0, 0);
    main.updateMatrixWorld(true);
    lod.update(main);
    expect(lod.selected[0]).toBe(0);
    const near = lod.children[0] as Group,
      mesh = near.children[0] as Mesh;
    const point = new Vector3()
      .fromBufferAttribute(mesh.geometry.getAttribute('position'), 0)
      .applyMatrix4(mesh.matrixWorld);
    expect(point.x).toBe(17);
    reflection.position.set(12, -100, 160);
    reflection.updateMatrixWorld(true);
    lod.update(reflection);
    expect(lod.selected).toEqual([0, 2]);
    expect(lod.children[2]!.visible).toBe(true);
    lod.update(main);
    expect(lod.children[0]!.visible).toBe(true);
    const shadow = root.children[1]!.children[0] as Mesh;
    expect(shadow.geometry).toBe((lod.children[1]!.children[0] as Mesh).geometry);
    expect(shadow.castShadow && shadow.visible).toBe(true);
    expect(shadow.layers.mask).toBe(1 << LAND_RENDER.layers.shadow);
    expect(mesh.castShadow).toBe(false);
    const scene = new Scene();
    scene.add(root);
    disposeObjectTree(scene);
  });

  it('共享几何/材质/贴图只释放一次，实例网格自身也释放矩阵缓存', () => {
    const scene = new Scene(),
      geometry = new BoxGeometry(),
      texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const instances = new InstancedMesh(geometry, material, 2);
    scene.add(new Mesh(geometry, material), new Mesh(geometry, material), instances);
    const geometryDispose = vi.spyOn(geometry, 'dispose'),
      materialDispose = vi.spyOn(material, 'dispose'),
      textureDispose = vi.spyOn(texture, 'dispose'),
      instanceDispose = vi.spyOn(instances, 'dispose');
    disposeObjectTree(scene);
    for (const spy of [geometryDispose, materialDispose, textureDispose, instanceDispose])
      expect(spy).toHaveBeenCalledTimes(1);
  });

  it('未挂入场景的构建自有材质也能随取消路径释放且不会重复释放', () => {
    const root = new Group(),
      texture = new Texture(),
      material = new MeshBasicMaterial({ map: texture }),
      materialDispose = vi.spyOn(material, 'dispose'),
      textureDispose = vi.spyOn(texture, 'dispose');

    disposeObjectTree(root, [material, material]);

    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
