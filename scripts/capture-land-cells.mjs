/** A3 固定画面与实际可见区块取证；调用方应先设置 reducedMotion=reduce 并打开 ?bench 页。 */
export async function captureLandCells(page) {
  return page.evaluate(async () => {
    const g = window.__G,
      next = () => new Promise((resolve) => requestAnimationFrame(resolve)),
      materials = new Map(),
      draws = [];
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      throw new Error('固定画面对照需要减动效');
    g.scene.traverse((object) => {
      if (object.material && !materials.has(object.material))
        materials.set(object.material, materials.size);
    });
    const original = g.renderer.renderBufferDirect;
    let collecting = false;
    g.renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      if (collecting) {
        const pass =
          camera === g.camera
            ? 'main'
            : camera.isOrthographicCamera && camera.layers.mask === 4
              ? 'shadow'
              : scene === g.scene
                ? 'reflection'
                : 'post';
        const common = {
          pass,
          material: materials.get(object.material),
          layers: object.layers.mask,
        };
        if (object.isBatchedMesh) {
          for (let i = 0; i < object._multiDrawCount; i++) {
            const id = object._indirectTexture.image.data[i];
            draws.push({
              ...common,
              name: 'land-static-batch',
              cell: object.userData.cells[id],
              triangles: object._multiDrawCounts[i] / 3,
            });
          }
        } else
          draws.push({
            ...common,
            name: object.name,
            cell: object.userData.cell,
            triangles:
              ((group?.count ?? geometry.index?.count ?? geometry.attributes.position.count) / 3) *
              (object.isInstancedMesh ? object.count : 1),
          });
      }
      return original.call(this, camera, scene, geometry, material, object, group);
    };
    try {
      for (let i = 0; i < 3; i++) await next();
      g.world.reflection.invalidate();
      g.renderer.shadowMap.needsUpdate = true;
      collecting = true;
      await next();
      collecting = false;
      return {
        image: g.renderer.domElement.toDataURL('image/png'),
        viewport: [innerWidth, innerHeight, devicePixelRatio],
        buffer: [g.renderer.domElement.width, g.renderer.domElement.height],
        calls: g.renderer.info.render.calls,
        triangles: g.renderer.info.render.triangles,
        draws,
        glError: g.renderer.getContext().getError(),
      };
    } finally {
      g.renderer.renderBufferDirect = original;
    }
  });
}
