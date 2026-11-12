import { ACESFilmicToneMapping, Color, SRGBColorSpace, WebGLRenderer } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { QualityProfile } from '@/00-types';
import { RENDER } from '@/01-shared';

export interface RendererOptions {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly profile: QualityProfile;
}

/**
 * Three 渲染器的唯一宿主：创建、画质应用、尺寸同步和释放都集中在这里。
 * SceneContext 只负责场景与相机，避免未来替换 WebGL 后把平台细节扩散到世界层。
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private readonly host: HTMLElement;

  constructor(host: HTMLElement, options: RendererOptions) {
    this.host = host;
    const width = Math.max(1, Math.floor(options.width));
    const height = Math.max(1, Math.floor(options.height));

    this.renderer = new WebGLRenderer({
      antialias: options.profile.antialias,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(new Color(RENDER.clearColor), 1);
    this.applyQuality(options.profile, options.pixelRatio);
    this.renderer.setSize(width, height, false);

    this.canvas = this.renderer.domElement;
    this.canvas.className = 'viewport-canvas';
    this.host.appendChild(this.canvas);
  }

  /**
   * 画质档位在创建时应用，像素比和阴影开关都由同一份 profile 决定，避免 low 档只降
   * 分辨率却仍然保留昂贵阴影。动态切换入口先保留，后续 UI 可复用而不用触碰渲染细节。
   */
  applyQuality(profile: QualityProfile, pixelRatio: number): void {
    this.renderer.setPixelRatio(Math.min(pixelRatio, profile.pixelRatioCap));
    this.renderer.shadowMap.enabled = profile.shadow;
  }

  resize(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    this.renderer.setSize(nextWidth, nextHeight, false);
  }

  render(scene: Scene, camera: PerspectiveCamera): void {
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.canvas.remove();
  }
}
