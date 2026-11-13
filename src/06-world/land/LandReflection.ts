import type { Reflector } from 'three/addons/objects/Reflector.js';
import { LAND_RENDER, LAND_RENDER_QUALITY } from '@/01-shared';
import { ReflectionSchedule } from '@/02-core';
import type { QualityTier } from '@/00-types';

/** 包装原生 Reflector，保留反射矩阵/斜裁剪；缓存帧绝不改拍摄时的纹理矩阵。 */
export function budgetReflection(water: Reflector, quality: QualityTier, reducedMotion: boolean) {
  const schedule = new ReflectionSchedule(
    1000 / LAND_RENDER_QUALITY[quality].reflectionHz,
    reducedMotion,
  );
  const original = water.onBeforeRender;
  const target = water.getRenderTarget(),
    size = target.width;
  let nowMs = 0;
  const stats = {
    updates: 0,
    rendered: false,
    calls: 0,
    triangles: 0,
    size,
    estimatedTargetBytes: size * size * 12,
    intervalHz: LAND_RENDER_QUALITY[quality].reflectionHz,
  };
  water.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    if (!schedule.needsUpdate(nowMs, camera.matrixWorld.elements, camera.projectionMatrix.elements))
      return;
    water.getReflectionCamera(camera).layers.set(LAND_RENDER.layers.reflection);
    const calls = renderer.info.render.calls,
      triangles = renderer.info.render.triangles;
    original.call(water, renderer, scene, camera, geometry, material, group);
    stats.calls = renderer.info.render.calls - calls;
    stats.triangles = renderer.info.render.triangles - triangles;
    stats.rendered = stats.calls > 0;
    if (stats.rendered) {
      stats.updates++;
      schedule.rendered(nowMs, camera.matrixWorld.elements, camera.projectionMatrix.elements);
    }
  };
  return {
    stats,
    invalidate: () => schedule.invalidate(),
    beginFrame(elapsedMs: number): void {
      nowMs = elapsedMs;
      stats.rendered = false;
      stats.calls = stats.triangles = 0;
    },
    setScale(scale: number): void {
      const next = Math.max(1, Math.round(size * scale));
      if (next === target.width) return;
      target.setSize(next, next);
      stats.size = next;
      stats.estimatedTargetBytes = next * next * 12;
      schedule.invalidate();
    },
  };
}
