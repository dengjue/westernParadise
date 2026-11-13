import { BatchedMesh } from 'three';
import type { BufferGeometry, Material, Mesh } from 'three';

/**
 * 合并 Builder 同材质顶层区块的提交；输入几何已烘焙到同一坐标系，矩阵必须保持单位阵。
 * 每个 cell 仍是独立裁剪范围，不把远端建筑并成一个不可裁剪的大网格。
 * 成功后消费输入几何；不兼容的布局保留原 Mesh 路径，调用方负责加入场景。
 */
export function batchStaticCells(
  meshes: readonly Mesh<BufferGeometry, Material>[],
): BatchedMesh | null {
  const first = meshes[0];
  if (!first || meshes.length < 2 || first.material.transparent) return null;
  const attributes = Object.keys(first.geometry.attributes);
  if (
    meshes.some(
      ({ geometry, material }) =>
        material !== first.material ||
        !geometry.index ||
        Object.keys(geometry.attributes).length !== attributes.length ||
        attributes.some((name) => {
          const expected = first.geometry.getAttribute(name),
            actual = geometry.getAttribute(name);
          return (
            !actual ||
            actual.itemSize !== expected.itemSize ||
            actual.normalized !== expected.normalized ||
            actual.array.constructor !== expected.array.constructor
          );
        }),
    )
  )
    return null;

  const batch = new BatchedMesh(
    meshes.length,
    meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count, 0),
    meshes.reduce((sum, mesh) => sum + mesh.geometry.index!.count, 0),
    first.material,
  );
  try {
    // 不透明区块用深度测试决定遮挡，按构建顺序提交以省去批内排序。
    // 原 Mesh 是按包围球深度排序；顺序变化及批着色器需通过固定画面对照验收。
    batch.sortObjects = false;
    batch.perObjectFrustumCulled = true;
    batch.name = 'land-static-multidraw';
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.layers.mask = first.layers.mask;
    batch.userData['cells'] = meshes.map((mesh) => mesh.userData['cell']);
    for (const mesh of meshes) batch.addInstance(batch.addGeometry(mesh.geometry));
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
  } catch (error) {
    batch.dispose();
    throw error;
  }
  for (const mesh of meshes) mesh.geometry.dispose();
  return batch;
}
