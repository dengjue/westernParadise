import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { Scene } from 'three';
import type { TimeOfDayPreset, WeatherPreset } from '@/00-types';
import { RENDER } from '@/01-shared';

export interface SkyDomeOptions {
  readonly scene: Scene;
  readonly timeOfDay: TimeOfDayPreset;
  readonly weather: WeatherPreset;
}

interface SkyUniforms {
  readonly [uniform: string]: { value: Color };
  readonly topColor: { value: Color };
  readonly bottomColor: { value: Color };
  readonly skyTint: { value: Color };
}

/**
 * 程序化天空穹顶只做上下两色渐变，不依赖贴图或外部资源。天气色调采用乘法中性色，
 * clear 的白色不会改变时段颜色，mist 的冷灰色可以与任意时段组合而不新增分支。
 */
export class SkyDome {
  private readonly scene: Scene;
  private readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly uniforms: SkyUniforms;

  constructor(options: SkyDomeOptions) {
    this.scene = options.scene;
    this.uniforms = {
      topColor: { value: new Color(options.timeOfDay.skyTopHex) },
      bottomColor: { value: new Color(options.timeOfDay.skyBottomHex) },
      skyTint: { value: new Color(options.weather.skyTintHex) },
    };

    const geometry = new SphereGeometry(
      RENDER.far * RENDER.skyDomeRadiusFactor,
      RENDER.skyDomeWidthSegments,
      RENDER.skyDomeHeightSegments,
    );
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 skyTint;
        varying vec2 vUv;
        void main() {
          vec3 gradient = mix(bottomColor, topColor, vUv.y);
          gl_FragColor = vec4(gradient * skyTint, 1.0);
        }
      `,
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  applyTimeOfDay(preset: TimeOfDayPreset): void {
    this.uniforms.topColor.value.setHex(preset.skyTopHex);
    this.uniforms.bottomColor.value.setHex(preset.skyBottomHex);
  }

  applyWeather(preset: WeatherPreset): void {
    this.uniforms.skyTint.value.setHex(preset.skyTintHex);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
