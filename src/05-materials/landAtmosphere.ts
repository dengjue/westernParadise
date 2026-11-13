import { ShaderChunk } from 'three';
import type { Color, CubeTexture, Material } from 'three';
import { LAND_ATMOSPHERE } from '@/01-shared';

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
  landEnvDawn: { value: CubeTexture };
  landEnvNoon: { value: CubeTexture };
  landEnvDusk: { value: CubeTexture };
  landLightWeights: { value: Float32Array };
}

/** 链接既有石材/风动着色器；稳态分支只采样一张 PMREM，中途重定向最多混合三张。 */
export function applyLandAtmosphere(material: Material, uniforms: LandAtmosphereUniforms): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
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
          uniform samplerCube landEnvDawn, landEnvNoon, landEnvDusk;
          uniform vec3 landLightWeights;
          vec4 sampleLandEnvironment(vec3 direction, float mip) {
            vec4 color = vec4(0.0);
            if (landLightWeights.x > 0.0) color += landLightWeights.x * textureLod(landEnvDawn, direction, mip);
            if (landLightWeights.y > 0.0) color += landLightWeights.y * textureLod(landEnvNoon, direction, mip);
            if (landLightWeights.z > 0.0) color += landLightWeights.z * textureLod(landEnvDusk, direction, mip);
            return color;
          }
        #endif
        ${ShaderChunk.envmap_physical_pars_fragment.replaceAll('textureLod( envMap,', 'sampleLandEnvironment(')}
      `,
      );
  };
  material.customProgramCacheKey = () => `land-air-v1:${previousKey}`;
  material.needsUpdate = true;
}
