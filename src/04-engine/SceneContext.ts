import {
  AmbientLight,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import type { Material } from 'three';
import type { QualityProfile } from '@/00-types';
import { RENDER } from '@/01-shared';

/**
 * 渲染上下文：唯一持有 scene / camera / renderer 的地方。
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
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

interface HasDisposableParts {
  readonly geometry?: { dispose(): void };
  readonly material?: Material | Material[];
}

function hasDisposableParts(value: object): value is object & HasDisposableParts {
  return 'geometry' in value || 'material' in value;
}

/** 统一释放几何体与材质。长时间运行时不释放会持续占用 GPU 显存。 */
function disposeObjectTree(root: Scene): void {
  root.traverse((object) => {
    if (!hasDisposableParts(object)) {
      return;
    }
    const candidate = object as object & HasDisposableParts;
    candidate.geometry?.dispose();
    const materials = candidate.material;
    if (Array.isArray(materials)) {
      for (const material of materials) {
        material.dispose();
      }
    } else {
      materials?.dispose();
    }
  });
}

export function createSceneContext(host: HTMLElement, options: SceneContextOptions): SceneContext {
  const { width, height, pixelRatio, profile } = options;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const scene = new Scene();
  scene.background = new Color(RENDER.clearColor);

  const camera = new PerspectiveCamera(RENDER.fovDeg, w / h, RENDER.near, RENDER.far);
  camera.position.set(RENDER.cameraStart.x, RENDER.cameraStart.y, RENDER.cameraStart.z);
  camera.lookAt(0, 1, 0);

  const renderer = new WebGLRenderer({
    antialias: profile.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(pixelRatio, profile.pixelRatioCap));
  renderer.setSize(w, h, false);
  renderer.setClearColor(new Color(RENDER.clearColor), 1);
  renderer.shadowMap.enabled = profile.shadow;

  const canvas = renderer.domElement;
  canvas.className = 'viewport-canvas';
  host.appendChild(canvas);

  // 冒烟阶段给一盏环境光：占位物体用了 MeshStandardMaterial，无光会全黑。
  const ambient = new AmbientLight(0xffffff, 1.4);
  scene.add(ambient);

  return {
    scene,
    camera,
    renderer,
    canvas,
    resize(nextWidth, nextHeight) {
      const nw = Math.max(1, Math.floor(nextWidth));
      const nh = Math.max(1, Math.floor(nextHeight));
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      // 第三个参数 false：不写 canvas 行内样式，尺寸由 CSS 统一控制。
      renderer.setSize(nw, nh, false);
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      disposeObjectTree(scene);
      scene.clear();
      renderer.dispose();
      canvas.remove();
    },
  };
}
