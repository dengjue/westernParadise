import type { MeshStandardMaterial } from 'three';
import { LAND_GARDEN } from '@/01-shared';

/** 只有 uniform 被逐帧改写。六个植物批次与反射共享同一个时间对象。 */
export function createGardenWind(reducedMotion: boolean) {
  const uniforms = { gardenTime: { value: 0 }, gardenMotion: { value: reducedMotion ? 0 : 1 } };
  return {
    uniforms,
    update(seconds: number): void {
      uniforms.gardenTime.value = reducedMotion ? 0 : seconds;
    },
  };
}

export type GardenWind = ReturnType<typeof createGardenWind>;

/** 叶根/瓣根为局部原点，绕根旋转保留枝梢连接；法线用同一矩阵旋转。 */
export function applyGardenWind(material: MeshStandardMaterial, wind: GardenWind): void {
  const settings = LAND_GARDEN.wind;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind.uniforms);
    shader.vertexShader =
      `
      uniform float gardenTime, gardenMotion;
      attribute vec4 gardenWind;
      mat3 gardenRotation() {
        float time = gardenTime * ${settings.speed.toFixed(4)} * gardenWind.w;
        float wave = sin(time + gardenWind.y)
          + ${settings.secondaryWeight.toFixed(4)} * sin(time * ${settings.secondarySpeed.toFixed(4)} + gardenWind.y * 2.31);
        float angle = wave * gardenWind.x * gardenWind.z * gardenMotion;
        float twist = angle * 0.35 * sin(gardenWind.y + time * 0.61);
        float c = cos(angle), s = sin(angle), ct = cos(twist), st = sin(twist);
        return mat3(ct, st, 0.0, -st, ct, 0.0, 0.0, 0.0, 1.0)
          * mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
      }
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nmat3 plantRotation = gardenRotation();\nobjectNormal = plantRotation * objectNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed = plantRotation * transformed;',
      );
  };
  material.customProgramCacheKey = () => 'land-garden-wind-v1';
  material.needsUpdate = true;
}
