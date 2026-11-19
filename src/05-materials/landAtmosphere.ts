import { ShaderChunk } from 'three';
import type { Color, Material, Texture } from 'three';
import { LAND_ATMOSPHERE, LAND_PMREM_ATLAS } from '@/01-shared';

/** 水和实体共用同一线性空间空气透视，不能在输出 sRGB 后再混入线性雾色。 */
export const LAND_HAZE_GLSL = `
  float landHaze(vec3 world) {
    float distanceToCamera = max(0.0, length(cameraPosition - world) - ${LAND_ATMOSPHERE.haze.start.toFixed(1)});
    float optical = distanceToCamera * ${LAND_ATMOSPHERE.haze.density.toFixed(5)};
    float heightDensity = exp(-max(0.0, world.y) * ${LAND_ATMOSPHERE.haze.heightFalloff.toFixed(4)});
    return clamp(1.0 - exp(-optical * optical * heightDensity), 0.0, 1.0);
  }
`;

export interface LandAtmosphereUniforms {
  landHazeColor: { value: Color };
  landEnvDawn: { value: Texture };
  landEnvNoon: { value: Texture };
  landEnvDusk: { value: Texture };
  landLightWeights: { value: Float32Array };
}

export type LandEnvironmentSampling = 'cube' | 'atlas';

const LAND_ATLAS_MAX_LEVEL = Math.log2(LAND_PMREM_ATLAS.maxMipSize / LAND_PMREM_ATLAS.minMipSize);
const LAND_ATLAS_SOURCE_LEVEL_OFFSET = Math.log2(
  LAND_ATMOSPHERE.environment.size / LAND_PMREM_ATLAS.maxMipSize,
);
const LAND_ENVIRONMENT_MAX_LEVEL = Math.log2(
  LAND_ATMOSPHERE.environment.size / LAND_PMREM_ATLAS.minMipSize,
);

const LAND_ATLAS_GLSL = `
  vec3 landFaceDirection(int face, vec2 uv) {
    if (face == 0) return vec3(1.0, -uv.y, -uv.x);
    if (face == 1) return vec3(-1.0, -uv.y, uv.x);
    if (face == 2) return vec3(uv.x, 1.0, uv.y);
    if (face == 3) return vec3(uv.x, -1.0, -uv.y);
    if (face == 4) return vec3(uv.x, -uv.y, 1.0);
    return vec3(-uv.x, -uv.y, -1.0);
  }

  void landAtlasCoordinates(vec3 direction, out int face, out vec2 uv) {
    vec3 axis = abs(direction);
    vec2 projected;
    if (axis.x >= axis.y && axis.x >= axis.z) {
      if (direction.x >= 0.0) {
        face = 0;
        projected = vec2(-direction.z, -direction.y) / axis.x;
      } else {
        face = 1;
        projected = vec2(direction.z, -direction.y) / axis.x;
      }
    } else if (axis.y >= axis.z) {
      if (direction.y >= 0.0) {
        face = 2;
        projected = vec2(direction.x, direction.z) / axis.y;
      } else {
        face = 3;
        projected = vec2(direction.x, -direction.z) / axis.y;
      }
    } else if (direction.z >= 0.0) {
      face = 4;
      projected = vec2(direction.x, -direction.y) / axis.z;
    } else {
      face = 5;
      projected = vec2(-direction.x, -direction.y) / axis.z;
    }
    uv = projected * 0.5 + 0.5;
  }

  vec4 landAtlasTexel(sampler2D atlas, int face, ivec2 pixel, int size, int level) {
    if (any(lessThan(pixel, ivec2(0))) || any(greaterThanEqual(pixel, ivec2(size)))) {
      vec2 projected = (vec2(pixel) + 0.5) * (2.0 / float(size)) - 1.0;
      int adjacentFace;
      vec2 adjacentUv;
      landAtlasCoordinates(landFaceDirection(face, projected), adjacentFace, adjacentUv);
      pixel = clamp(ivec2(floor(adjacentUv * float(size))), ivec2(0), ivec2(size - 1));
      face = adjacentFace;
    }
    return texelFetch(atlas, ivec2(pixel.x, face * size + pixel.y), level);
  }

  vec4 landAtlasLevel(sampler2D atlas, vec3 direction, int level) {
    int size = ${LAND_PMREM_ATLAS.maxMipSize} >> level;
    int face;
    vec2 uv;
    landAtlasCoordinates(direction, face, uv);
    vec2 position = uv * float(size) - 0.5;
    ivec2 pixel = ivec2(floor(position));
    vec2 fraction = fract(position);
    vec4 top = mix(
      landAtlasTexel(atlas, face, pixel, size, level),
      landAtlasTexel(atlas, face, pixel + ivec2(1, 0), size, level),
      fraction.x
    );
    vec4 bottom = mix(
      landAtlasTexel(atlas, face, pixel + ivec2(0, 1), size, level),
      landAtlasTexel(atlas, face, pixel + ivec2(1, 1), size, level),
      fraction.x
    );
    return mix(top, bottom, fraction.y);
  }

  vec4 sampleLandAtlas(sampler2D atlas, vec3 direction, float mip) {
    float boundedMip = clamp(mip - ${LAND_ATLAS_SOURCE_LEVEL_OFFSET.toFixed(1)}, 0.0, ${LAND_ATLAS_MAX_LEVEL.toFixed(1)});
    int lowerLevel = int(floor(boundedMip));
    int upperLevel = min(lowerLevel + 1, ${LAND_ATLAS_MAX_LEVEL});
    return mix(
      landAtlasLevel(atlas, direction, lowerLevel),
      landAtlasLevel(atlas, direction, upperLevel),
      fract(boundedMip)
    );
  }
`;

/** 链接既有石材/风动着色器；稳态分支只采样一张 PMREM，中途重定向最多混合三张。 */
export function applyLandAtmosphere(
  material: Material,
  uniforms: LandAtmosphereUniforms,
  sampling: LandEnvironmentSampling = 'cube',
): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  if (
    sampling === 'atlas' &&
    ('isMeshStandardMaterial' in material || 'isMeshPhysicalMaterial' in material)
  ) {
    // 场景环境为空时，Three 不会自动启用 PBR 环境分支；仅给 PBR 材质补上
    // r187 的公开 shader define，实际采样仍由下方的 2D 图集 hook 完成。
    material.defines = {
      ...material.defines,
      USE_ENVMAP: '',
      ENVMAP_TYPE_PMREM: '',
      ENVMAP_SIZE: `${LAND_ATMOSPHERE.environment.size}.0`,
      ENVMAP_MAX_LOD: `${LAND_ENVIRONMENT_MAX_LEVEL}.0`,
    };
  }
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (sampling === 'atlas' && shader.uniforms.envMapIntensity)
      shader.uniforms.envMapIntensity.value = LAND_ATMOSPHERE.environment.intensity;
    shader.vertexShader = 'varying vec3 vLandWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 landWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        landWorld = instanceMatrix * landWorld;
      #endif
      vLandWorld = (modelMatrix * landWorld).xyz;
      #include <project_vertex>
    `,
    );
    shader.fragmentShader =
      `varying vec3 vLandWorld;
      uniform vec3 landHazeColor;
      ${LAND_HAZE_GLSL}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_fragment>', '')
      .replace(
        '#include <tonemapping_fragment>',
        `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, landHazeColor, landHaze(vLandWorld));
        #include <tonemapping_fragment>
      `,
      )
      .replace(
        '#include <envmap_physical_pars_fragment>',
        `
         #ifdef USE_ENVMAP
           uniform ${sampling === 'atlas' ? 'sampler2D' : 'samplerCube'} landEnvDawn, landEnvNoon, landEnvDusk;
           uniform vec3 landLightWeights;
           ${sampling === 'atlas' ? LAND_ATLAS_GLSL : ''}
           vec4 sampleLandEnvironment(vec3 direction, float mip) {
             vec4 color = vec4(0.0);
             if (landLightWeights.x > 0.0) color += landLightWeights.x * ${sampling === 'atlas' ? 'sampleLandAtlas' : 'textureLod'}(landEnvDawn, direction, mip);
             if (landLightWeights.y > 0.0) color += landLightWeights.y * ${sampling === 'atlas' ? 'sampleLandAtlas' : 'textureLod'}(landEnvNoon, direction, mip);
             if (landLightWeights.z > 0.0) color += landLightWeights.z * ${sampling === 'atlas' ? 'sampleLandAtlas' : 'textureLod'}(landEnvDusk, direction, mip);
             return color;
           }
        #endif
        ${ShaderChunk.envmap_physical_pars_fragment.replaceAll('textureLod( envMap,', 'sampleLandEnvironment(')}
      `,
      );
  };
  material.customProgramCacheKey = () => `land-air-v2:${sampling}:${previousKey}`;
  material.needsUpdate = true;
}
