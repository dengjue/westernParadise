/** 固定近景检查机位。只供有 __G 的诊断页面使用，便于逐阶段同角度对照。 */
export const LAND_DETAIL_VIEWS = Object.freeze({
  facade: { position: [26, 11.5, -10], target: [0, 13, -51] },
  eaves: { position: [9, 13, -30], target: [0, 17.5, -42] },
  plinth: { position: [8.8, 5.8, -33.5], target: [4, 4.1, -38.3] },
  sculpture: { position: [11, 9, -41], target: [0, 10.5, -55] },
});

export async function inspectLandDetail(page, name) {
  const view = LAND_DETAIL_VIEWS[name];
  if (!view) throw new Error(`未知检查机位：${name}`);
  await page.evaluate(({ position, target }) => {
    const { landCamera: controls, camera, events } = window.__G;
    events.emit('land:tour', { enabled: false });
    controls.selectView(2, true);
    controls.position.fromArray(position);
    controls.target.fromArray(target);
    controls.look.copy(controls.target);
    controls.offset.copy(controls.position).sub(controls.target);
    controls.distance = controls.offset.length();
    controls.orbitYaw = Math.atan2(controls.offset.x, controls.offset.z);
    controls.orbitPitch = Math.asin(controls.offset.y / controls.distance);
    controls.zoom = 1;
    camera.position.copy(controls.position);
    camera.lookAt(controls.target);
  }, view);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
