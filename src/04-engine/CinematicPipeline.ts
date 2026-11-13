import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PURE_LAND } from '@/01-shared';
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
  if (quality === 'low' || quality === 'medium') {
    return {
      render: () => renderer.render(scene, camera),
      resize: (_w: number, _h: number) => undefined,
      dispose: () => undefined,
    };
  }
  const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: 2 });
  const composer = new EffectComposer(renderer, target);
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
  return {
    render: () => composer.render(),
    resize: (w: number, h: number) => composer.setSize(w, h),
    dispose: () => {
      bloom.dispose();
      output.dispose();
      composer.dispose();
    },
  };
}
