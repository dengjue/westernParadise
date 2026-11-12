import { describe, expect, it } from 'vitest';
import { AmbientLight, DirectionalLight, Scene } from 'three';
import type { Color, Fog, Mesh, ShaderMaterial, SphereGeometry, WebGLRenderer } from 'three';
import { LightingRig, SkyDome } from '@/06-world';
import { QUALITY_PROFILES, TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '@/01-shared';

/** 只模拟 LightingRig 会写入的渲染器字段，测试不需要创建真实 WebGL 上下文。 */
function fakeRenderer(): WebGLRenderer {
  return { toneMappingExposure: 0 } as unknown as WebGLRenderer;
}

function countLights(scene: Scene): number {
  return scene.children.filter(
    (child) => child instanceof AmbientLight || child instanceof DirectionalLight,
  ).length;
}

describe('LightingRig', () => {
  it('low 档只保留太阳方向光，不启用阴影', () => {
    const scene = new Scene();
    const renderer = fakeRenderer();
    const rig = new LightingRig({
      scene,
      renderer,
      profile: QUALITY_PROFILES.low,
      timeOfDay: TIME_OF_DAY_PRESETS.noon,
      weather: WEATHER_PRESETS.clear,
    });

    expect(countLights(scene)).toBe(1);
    const sun = scene.children.find((child) => child instanceof DirectionalLight);
    expect(sun).toBeInstanceOf(DirectionalLight);
    expect((sun as DirectionalLight).castShadow).toBe(false);
    expect(QUALITY_PROFILES.low.pixelRatioCap).toBeLessThanOrEqual(1);
    expect(QUALITY_PROFILES.low.shadowMapSize).toBe(0);

    rig.dispose();
  });

  it('时段与天气替换会同时更新光照、曝光和雾参数', () => {
    const scene = new Scene();
    const renderer = fakeRenderer();
    const rig = new LightingRig({
      scene,
      renderer,
      profile: QUALITY_PROFILES.high,
      timeOfDay: TIME_OF_DAY_PRESETS.noon,
      weather: WEATHER_PRESETS.clear,
    });

    rig.applyTimeOfDay(TIME_OF_DAY_PRESETS.dusk);
    rig.applyWeather(WEATHER_PRESETS.mist);

    expect(renderer.toneMappingExposure).toBe(TIME_OF_DAY_PRESETS.dusk.exposure);
    const fog = scene.fog as Fog | null;
    expect(fog).not.toBeNull();
    expect(fog?.near).toBe(3.5);
    expect(fog?.far).toBe(49.5);

    rig.dispose();
    expect(scene.fog).toBeNull();
  });

  it('high 档启用太阳阴影并使用配置中的 shadowMapSize', () => {
    const scene = new Scene();
    const rig = new LightingRig({
      scene,
      renderer: fakeRenderer(),
      profile: QUALITY_PROFILES.high,
      timeOfDay: TIME_OF_DAY_PRESETS.dawn,
      weather: WEATHER_PRESETS.clear,
    });
    const sun = scene.children.find((child) => child instanceof DirectionalLight);

    expect(sun).toBeInstanceOf(DirectionalLight);
    expect((sun as DirectionalLight).castShadow).toBe(true);
    expect((sun as DirectionalLight).shadow.mapSize.x).toBe(QUALITY_PROFILES.high.shadowMapSize);

    rig.dispose();
  });
});

describe('SkyDome', () => {
  it('创建程序化穹顶并可切换时段与天气颜色', () => {
    const scene = new Scene();
    const sky = new SkyDome({
      scene,
      timeOfDay: TIME_OF_DAY_PRESETS.dawn,
      weather: WEATHER_PRESETS.clear,
    });
    const mesh = scene.getObjectByName('sky-dome') as Mesh<SphereGeometry, ShaderMaterial> | null;
    const material = mesh?.material ?? null;

    expect(mesh).not.toBeNull();
    expect(material).not.toBeNull();
    expect((material?.uniforms['topColor']?.value as Color).getHex()).toBe(
      TIME_OF_DAY_PRESETS.dawn.skyTopHex,
    );

    sky.applyTimeOfDay(TIME_OF_DAY_PRESETS.dusk);
    sky.applyWeather(WEATHER_PRESETS.mist);
    expect((material?.uniforms['topColor']?.value as Color).getHex()).toBe(
      TIME_OF_DAY_PRESETS.dusk.skyTopHex,
    );
    expect((material?.uniforms['skyTint']?.value as Color).getHex()).toBe(
      WEATHER_PRESETS.mist.skyTintHex,
    );

    sky.dispose();
    expect(scene.getObjectByName('sky-dome')).toBeUndefined();
  });
});
