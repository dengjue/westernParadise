import { describe, expect, it } from 'vitest';
import { Color, CubeTexture, MeshStandardMaterial, ShaderLib } from 'three';
import type { WebGLRenderer } from 'three';
import { LAND_ATMOSPHERE } from '@/01-shared';
import { LandLightTransition } from '@/02-core';
import { applyGardenWind, applyLandAtmosphere, createGardenWind } from '@/05-materials';

describe('光阴权重与环境反射一致性', () => {
  it('在固定时长内平滑到端点，重复目标不重启，端点权重精确且不再更新', () => {
    const light = new LandLightTransition('dawn', false);
    expect(light.request('noon')).toBe(true);
    light.update(LAND_ATMOSPHERE.transitionMs / 2);
    expect(Array.from(light.weights)).toEqual([0.5, 0.5, 0]);
    expect(light.request('noon')).toBe(false);
    light.update(LAND_ATMOSPHERE.transitionMs / 2);
    expect(Array.from(light.weights)).toEqual([0, 1, 0]);
    expect(light.active).toBe(false);
    expect(light.update(100)).toBe(false);
  });

  it('连续中断从当前混合出发，无负权重/亮度和跳变，快慢步长终点一致', () => {
    const light = new LandLightTransition('dawn', false);
    light.request('noon');
    light.update(900);
    const before = Array.from(light.weights);
    light.request('dusk');
    expect(Array.from(light.weights)).toEqual(before);
    for (let i = 0; i < 400; i++) {
      light.update(10);
      expect(light.weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
      for (const weight of light.weights) expect(weight).toBeGreaterThanOrEqual(0);
    }
    expect(Array.from(light.weights)).toEqual([0, 0, 1]);
    light.request('dawn');
    light.update(10000);
    expect(Array.from(light.weights)).toEqual([1, 0, 0]);
  });

  it('减动效立即切换且静止不更新', () => {
    const light = new LandLightTransition('dusk', true);
    light.request('noon');
    expect(Array.from(light.weights)).toEqual([0, 1, 0]);
    expect(light.active).toBe(false);
    expect(light.update(4000)).toBe(false);
  });

  it('空气透视/环境混合与植物位置和法线风动链共存，雾混合位于色调映射之前', () => {
    const material = new MeshStandardMaterial(),
      wind = createGardenWind(false);
    applyGardenWind(material, wind);
    const weights = new Float32Array([1, 0, 0]),
      texture = new CubeTexture();
    applyLandAtmosphere(material, {
      landLightWeights: { value: weights },
      landHazeColor: { value: new Color() },
      landEnvDawn: { value: texture },
      landEnvNoon: { value: texture },
      landEnvDusk: { value: texture },
    });
    const shader = {
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
      uniforms: {},
    } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.uniforms).toMatchObject({
      gardenTime: wind.uniforms.gardenTime,
      landLightWeights: { value: weights },
    });
    expect(shader.vertexShader).toContain('objectNormal = plantRotation * objectNormal');
    expect(shader.vertexShader).toContain('landWorld = instanceMatrix * landWorld');
    expect(shader.fragmentShader).not.toContain('textureLod( envMap,');
    expect(shader.fragmentShader.indexOf('mix(gl_FragColor.rgb, landHazeColor')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <tonemapping_fragment>'),
    );
    expect(material.customProgramCacheKey()).toContain('land-garden-wind-v1');
    material.dispose();
    texture.dispose();
  });
});
