import { AmbientLight, DirectionalLight, Fog } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import type { QualityProfile, TimeOfDayPreset, WeatherPreset } from '@/00-types';

export interface LightingRigOptions {
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  readonly profile: QualityProfile;
  readonly timeOfDay: TimeOfDayPreset;
  readonly weather: WeatherPreset;
}

/**
 * 光照唯一入口：太阳、环境光和 scene.fog 都在这里创建与更新。
 * 时段与天气分别更新自己的配置快照，再由同一套组合逻辑写入，保证雾和曝光不会落后
 * 于天空颜色；low 档不加入环境光，严格遵守最多一盏灯的降级约束。
 */
export class LightingRig {
  private readonly scene: Scene;
  private readonly renderer: WebGLRenderer;
  private readonly sun: DirectionalLight;
  private readonly ambient: AmbientLight | null;
  private readonly fog: Fog;
  private timeOfDay: TimeOfDayPreset;
  private weather: WeatherPreset;

  constructor(options: LightingRigOptions) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.timeOfDay = options.timeOfDay;
    this.weather = options.weather;

    this.sun = new DirectionalLight(
      options.timeOfDay.sun.colorHex,
      options.timeOfDay.sun.intensity,
    );
    this.sun.castShadow = options.profile.shadow;
    if (options.profile.shadow && options.profile.shadowMapSize > 0) {
      this.sun.shadow.mapSize.set(options.profile.shadowMapSize, options.profile.shadowMapSize);
    }
    this.scene.add(this.sun);

    this.ambient =
      options.profile.maxLights > 1
        ? new AmbientLight(options.timeOfDay.ambient.colorHex, options.timeOfDay.ambient.intensity)
        : null;
    if (this.ambient !== null) {
      this.scene.add(this.ambient);
    }

    this.fog = new Fog(
      options.timeOfDay.fog.colorHex,
      options.timeOfDay.fog.near * options.weather.fogScale.near,
      options.timeOfDay.fog.far * options.weather.fogScale.far,
    );
    this.scene.fog = this.fog;
    this.applyTimeOfDay(options.timeOfDay);
    this.applyWeather(options.weather);
  }

  applyTimeOfDay(preset: TimeOfDayPreset): void {
    this.timeOfDay = preset;
    this.sun.color.setHex(preset.sun.colorHex);
    this.sun.intensity = preset.sun.intensity;

    const elevation = (preset.sun.elevationDeg * Math.PI) / 180;
    const azimuth = (preset.sun.azimuthDeg * Math.PI) / 180;
    const horizontal = Math.cos(elevation);
    this.sun.position.set(
      horizontal * Math.cos(azimuth),
      Math.sin(elevation),
      horizontal * Math.sin(azimuth),
    );

    if (this.ambient !== null) {
      this.ambient.color.setHex(preset.ambient.colorHex);
      this.ambient.intensity = preset.ambient.intensity;
    }
    this.renderer.toneMappingExposure = preset.exposure;
    this.applyFog();
  }

  applyWeather(preset: WeatherPreset): void {
    this.weather = preset;
    this.applyFog();
  }

  dispose(): void {
    this.scene.remove(this.sun);
    if (this.ambient !== null) {
      this.scene.remove(this.ambient);
    }
    if (this.scene.fog === this.fog) {
      this.scene.fog = null;
    }
  }

  private applyFog(): void {
    this.fog.color.setHex(this.timeOfDay.fog.colorHex);
    this.fog.near = this.timeOfDay.fog.near * this.weather.fogScale.near;
    this.fog.far = this.timeOfDay.fog.far * this.weather.fogScale.far;
  }
}
