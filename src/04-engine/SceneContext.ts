import { PerspectiveCamera, Scene, Texture } from 'three';
import type { Material } from 'three';
import type { QualityProfile } from '@/00-types';
import { RENDER } from '@/01-shared';
import { Renderer } from './Renderer';

/**
 * 渲染上下文：持有 scene / camera，并把实际渲染职责委托给 Renderer。
 *
 * 分层考虑：本层不读 window、不读 URL、不做画质决策，
 * 所有环境相关数值由 99-boot 从 platform 层取好后传入，
 * 这样渲染层可以独立替换（例如将来换 WebGPU 后端）。
 */

export interface SceneContextOptions {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly profile: QualityProfile;
}

export interface SceneContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly rendering: Renderer;
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

interface HasDisposableParts {
  readonly geometry?: { dispose(): void };
  readonly material?: Material | Material[];
}

const MATERIAL_TEXTURE_KEYS = Object.freeze([
  'alphaMap',
  'aoMap',
  'bumpMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'iridescenceMap',
  'lightMap',
  'map',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularColorMap',
  'specularIntensityMap',
  'thicknessMap',
  'transmissionMap',
] as const);

function hasDisposableParts(value: object): value is object & HasDisposableParts {
  return 'geometry' in value || 'material' in value;
}

function disposeMaterial(material: Material, textures: Set<Texture>): void {
  const candidate = material as Material & Record<string, unknown>;
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const value = candidate[key];
    if (value instanceof Texture && !textures.has(value)) {
      textures.add(value);
      value.dispose();
    }
  }
  material.dispose();
}

/** 统一释放几何体、材质与材质贴图，长时间运行时不释放会持续占用 GPU 显存。 */
function disposeObjectTree(root: Scene): void {
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!hasDisposableParts(object)) {
      return;
    }
    const candidate = object as object & HasDisposableParts;
    candidate.geometry?.dispose();
    const materials = candidate.material;
    if (Array.isArray(materials)) {
      for (const material of materials) {
        disposeMaterial(material, textures);
      }
    } else {
      if (materials !== undefined) {
        disposeMaterial(materials, textures);
      }
    }
  });
}

export function createSceneContext(host: HTMLElement, options: SceneContextOptions): SceneContext {
  const { width, height, pixelRatio, profile } = options;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const scene = new Scene();

  const camera = new PerspectiveCamera(RENDER.fovDeg, w / h, RENDER.near, RENDER.far);
  camera.position.set(RENDER.cameraStart.x, RENDER.cameraStart.y, RENDER.cameraStart.z);
  camera.lookAt(0, 1, 0);

  const rendering = new Renderer(host, {
    width: w,
    height: h,
    pixelRatio,
    profile,
  });

  return {
    scene,
    camera,
    rendering,
    canvas: rendering.canvas,
    resize(nextWidth, nextHeight) {
      const nw = Math.max(1, Math.floor(nextWidth));
      const nh = Math.max(1, Math.floor(nextHeight));
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      rendering.resize(nw, nh);
    },
    render() {
      rendering.render(scene, camera);
    },
    dispose() {
      disposeObjectTree(scene);
      scene.clear();
      rendering.dispose();
    },
  };
}
