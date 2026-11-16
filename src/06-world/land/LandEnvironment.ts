import { Mesh, PMREMGenerator, Scene } from 'three';
import type { ShaderMaterial, SphereGeometry, WebGLRenderer } from 'three';
import { LAND_ATMOSPHERE, LAND_TIMES } from '@/01-shared';

type EnvironmentTarget = ReturnType<PMREMGenerator['fromScene']>;
type EnvironmentBaker = Pick<PMREMGenerator, 'fromScene' | 'dispose'>;

export interface LandEnvironmentHandle {
  targets: EnvironmentTarget[];
  stats: {
    bakes: number;
    maps: Array<{
      size: number;
      faces: number;
      mipCount: number;
      estimatedBytes: number;
    }>;
    estimatedBytes: number;
  };
  dispose(): void;
}

/** r187 PMREM 是带预滤波 mip 的立方体；三张只在创建时烘焙，切时段不生成目标或纹理。 */
export function* createLandEnvironmentSteps(
  renderer: WebGLRenderer,
  sky: Mesh<SphereGeometry, ShaderMaterial>,
  prepare: (index: number) => void,
  onStage?: (stage: string) => void,
  createBaker: (renderer: WebGLRenderer) => EnvironmentBaker = (value) => new PMREMGenerator(value),
): Generator<void, LandEnvironmentHandle, void> {
  const generator = createBaker(renderer),
    scene = new Scene();
  scene.add(new Mesh(sky.geometry, sky.material));
  const toneMapped = sky.material.toneMapped;
  sky.material.toneMapped = false;
  const targets: EnvironmentTarget[] = [];
  let completed = false;
  try {
    for (let index = 0; index < LAND_TIMES.length; index++) {
      prepare(index);
      onStage?.(`environment:bake-${index}`);
      targets.push(
        generator.fromScene(scene, LAND_ATMOSPHERE.environment.blur, 0.1, 1600, {
          size: LAND_ATMOSPHERE.environment.size,
        }),
      );
      yield;
    }
    const maps = targets.map((target) => ({
      size: target.width,
      faces: 6,
      mipCount: target.texture.mipmaps.length,
      // 每面 RGBA16F=8 字节，无深度附件；实际 mip 到 8²，不是传统满链估算。
      estimatedBytes: target.texture.mipmaps.reduce(
        (sum: number, _mip, level) => sum + 6 * 8 * (target.width >> level) ** 2,
        0,
      ),
    }));
    let disposed = false;
    const result: LandEnvironmentHandle = {
      targets,
      stats: {
        bakes: targets.length,
        maps,
        estimatedBytes: maps.reduce((sum, map) => sum + map.estimatedBytes, 0),
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        for (const target of targets) target.dispose();
      },
    };
    completed = true;
    return result;
  } finally {
    if (!completed) for (const target of targets) target.dispose();
    generator.dispose();
    sky.material.toneMapped = toneMapped;
    sky.material.needsUpdate = true;
  }
}

export function createLandEnvironment(
  renderer: WebGLRenderer,
  sky: Mesh<SphereGeometry, ShaderMaterial>,
  prepare: (index: number) => void,
): LandEnvironmentHandle {
  const steps = createLandEnvironmentSteps(renderer, sky, prepare);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
