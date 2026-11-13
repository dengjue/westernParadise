import { Object3D, Vector3 } from 'three';
import type { Camera } from 'three';
import { distanceLevel } from '@/02-core';
import { LAND_RENDER } from '@/01-shared';

/** WebGLRenderer 在每个相机的 projectObject 阶段调用 update，反射不复用主相机的可见性。 */
// 必须继承 Object3D；渲染器先检查 isGroup，再检查 isLOD，Group 会绕过自动选级。
export class DistanceLod extends Object3D {
  readonly isLOD = true;
  readonly autoUpdate = true;
  readonly selected = [-1, -1];
  private readonly cameraPosition = new Vector3();
  private readonly center = new Vector3();

  constructor(
    levels: readonly Object3D[],
    center: readonly [number, number, number],
    private readonly radius: number,
    private readonly thresholds: readonly number[],
    private readonly hysteresis: number,
    private readonly minimum: number,
  ) {
    super();
    this.layers.enable(LAND_RENDER.layers.reflection);
    this.position.fromArray(center);
    for (const level of levels) {
      level.position.sub(this.position);
      this.add(level);
    }
    this.name = 'land-distance-lod';
  }

  update(camera: Camera): void {
    const reflection =
      camera.layers.isEnabled(LAND_RENDER.layers.reflection) &&
      !camera.layers.isEnabled(LAND_RENDER.layers.main);
    const pass = reflection ? 1 : 0;
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.center.setFromMatrixPosition(this.matrixWorld);
    const distance = Math.max(0, this.cameraPosition.distanceTo(this.center) - this.radius);
    const minimum = reflection
      ? Math.max(this.minimum, LAND_RENDER.lod.reflectionMinimum)
      : this.minimum;
    const level = distanceLevel(
      distance,
      this.selected[pass]!,
      this.thresholds,
      this.hysteresis,
      minimum,
    );
    this.selected[pass] = level;
    for (let i = 0; i < this.children.length; i++) this.children[i]!.visible = i === level;
  }
}
