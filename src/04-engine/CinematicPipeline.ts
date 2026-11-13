import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LAND_RENDER_QUALITY, PURE_LAND } from '@/01-shared';
import type { QualityTier } from '@/00-types';

/** HDR 泛光只提取高亮，保留石材和瓦垄细节。低档直接渲染以控制带宽。 */
export function createCinematicPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  quality: QualityTier,
  width: number,
  height: number,
) {
  const config = LAND_RENDER_QUALITY[quality];
  const stats = {
    postWidth: 0,
    postHeight: 0,
    samples: 0,
    targetPixels: 0,
    estimatedTargetBytes: 0,
  };
  if (quality === 'low' || quality === 'medium') {
    return {
      stats,
      render: () => renderer.render(scene, camera),
      resize: (_w: number, _h: number) => undefined,
      setScale: (_scale: number) => undefined,
      dispose: () => undefined,
    };
  }
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    samples: config.samples,
  });
  const composer = new EffectComposer(renderer, target);
  const postPixelRatio = Math.min(renderer.getPixelRatio(), config.postPixelRatio);
  // 直接传整数像素尺寸，避免 renderTarget.width 与驱动实际分配尺寸出现小数偏差。
  composer.setPixelRatio(1);
  const render = new RenderPass(scene, camera);
  const settings = PURE_LAND.rendering;
  const bloom = new UnrealBloomPass(
    new Vector2(width, height),
    settings.bloomStrength,
    settings.bloomRadius,
    settings.bloomThreshold,
  );
  const output = new OutputPass();
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(output);
  let scale = 1;
  function resize(w: number, h: number): void {
    width = w;
    height = h;
    // 初始化与后续 resize 使用完全相同的像素比；避免首次目标尺寸与泛光 mip 尺寸不一致。
    composer.setSize(
      Math.max(1, Math.floor(w * postPixelRatio * scale)),
      Math.max(1, Math.floor(h * postPixelRatio * scale)),
    );
    stats.postWidth = composer.renderTarget1.width;
    stats.postHeight = composer.renderTarget1.height;
    stats.samples = config.samples;
    stats.targetPixels = 0;
    stats.estimatedTargetBytes = 0;
    const targets = [
      composer.renderTarget1,
      composer.renderTarget2,
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical,
    ];
    for (const buffer of targets) {
      const pixels = buffer.width * buffer.height;
      stats.targetPixels += pixels;
      // RGBA16F=8 B，深度按 4 B 估算；多重采样颜色/深度附件单列，不是总显存测量。
      stats.estimatedTargetBytes +=
        pixels * (8 + (buffer.depthBuffer ? 4 : 0)) * (1 + buffer.samples);
    }
  }
  resize(width, height);
  return {
    stats,
    render: () => composer.render(),
    resize,
    setScale(next: number): void {
      scale = next;
      resize(width, height);
    },
    dispose: () => {
      bloom.dispose();
      output.dispose();
      composer.dispose();
    },
  };
}
