/** 园林固定近景；与建筑近景脚本相同，只操作诊断相机。 */
export const LAND_GARDEN_VIEWS = Object.freeze({
  lotus: { position: [17, 3.4, 52], target: [16.8, 0.1, 44] },
  crown: { position: [-37, 13.5, 31], target: [-30, 10, 15.8] },
  pearls: { position: [-54, 9.5, 13], target: [-47, 8, 9] },
  shore: { position: [8, 4.8, 62], target: [23, 0.6, 50] },
});

export async function inspectLandGarden(page, name) {
  const view = LAND_GARDEN_VIEWS[name];
  if (!view) throw new Error(`未知园林机位：${name}`);
  await page.evaluate(({ position, target }) => {
    const { landCamera: controls, camera, events } = window.__G;
    events.emit('land:tour', { enabled: false });
    controls.selectView(1, true);
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
