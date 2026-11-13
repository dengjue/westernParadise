import { MeshStandardMaterial, NoColorSpace, ShaderChunk } from 'three';
import type { CanvasTexture } from 'three';

/** 世界坐标投影同时驱动色彩、粗糙度和凹凸，防止石缝与光照凹痕错位。 */
export function projectedStone(
  texture: CanvasTexture,
  color: number,
  settings: { roughness: number; metalness: number; bump: number; scale: number },
): MeshStandardMaterial {
  const detail = texture.clone();
  detail.colorSpace = NoColorSpace;
  const material = new MeshStandardMaterial({
    color,
    map: texture,
    bumpMap: detail,
    roughnessMap: detail,
    bumpScale: settings.bump,
    roughness: settings.roughness,
    metalness: settings.metalness,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vStoneWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvStoneWorld = (modelMatrix * vec4(position,1.0)).xyz;',
    );
    shader.fragmentShader =
      `
      varying vec3 vStoneWorld;
      vec2 landSurfaceUv() {
        vec3 axis = abs(normalize(cross(dFdx(vStoneWorld), dFdy(vStoneWorld))));
        vec2 projected = axis.y > max(axis.x, axis.z) ? vStoneWorld.xz
          : (axis.x > axis.z ? vStoneWorld.zy : vStoneWorld.xy);
        return projected * ${settings.scale.toFixed(4)};
      }
    ` + shader.fragmentShader;
    for (const [chunk, uv] of [
      ['map_fragment', 'vMapUv'],
      ['roughnessmap_fragment', 'vRoughnessMapUv'],
      ['bumpmap_pars_fragment', 'vBumpMapUv'],
    ] as const) {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <${chunk}>`,
        ShaderChunk[chunk].replaceAll(uv, 'landSurfaceUv()'),
      );
    }
  };
  // 色/凹凸贴图数量相同的两种石材也必须按投影尺度区分 shader 缓存。
  material.customProgramCacheKey = () => `land-stone-${settings.scale}`;
  return material;
}
