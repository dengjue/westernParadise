import { Mesh, PMREMGenerator, Scene } from 'three';
import type { ShaderMaterial, SphereGeometry, WebGLRenderer } from 'three';
import { LAND_ATMOSPHERE, LAND_TIMES } from '@/01-shared';

/** r187 PMREM 是带预滤波 mip 的立方体；三张只在创建时烘焙，切时段不生成目标或纹理。 */
export function createLandEnvironment(
  renderer: WebGLRenderer,
  sky: Mesh<SphereGeometry, ShaderMaterial>,
  prepare: (index: number) => void,
) {
  const generator = new PMREMGenerator(renderer),
    scene = new Scene();
  scene.add(new Mesh(sky.geometry, sky.material));
  const toneMapped = sky.material.toneMapped;
  sky.material.toneMapped = false;
  const targets: ReturnType<PMREMGenerator['fromScene']>[] = [];
  try {
    for (let index = 0; index < LAND_TIMES.length; index++) {
      prepare(index);
      targets.push(
        generator.fromScene(scene, LAND_ATMOSPHERE.environment.blur, 0.1, 1600, {
          size: LAND_ATMOSPHERE.environment.size,
        }),
      );
    }
  } catch (error) {
    for (const target of targets) target.dispose();
    throw error;
  } finally {
    generator.dispose();
    sky.material.toneMapped = toneMapped;
    sky.material.needsUpdate = true;
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
  return {
    targets,
    stats: {
      bakes: targets.length,
      maps,
      estimatedBytes: maps.reduce((sum, map) => sum + map.estimatedBytes, 0),
    },
    dispose(): void {
      for (const target of targets) target.dispose();
    },
  };
}
