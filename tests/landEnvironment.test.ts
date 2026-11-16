import { Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { PMREMGenerator, WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createLandEnvironmentSteps,
  type LandEnvironmentHandle,
} from '../src/06-world/land/LandEnvironment';

describe('createLandEnvironmentSteps cancellation', () => {
  it('releases baked PMREM targets and restores the sky material when cancelled', () => {
    const targetDispose = vi.fn();
    const bake = vi.fn(
      () =>
        ({
          width: 16,
          texture: { mipmaps: [{}, {}] },
          dispose: targetDispose,
        }) as unknown as ReturnType<PMREMGenerator['fromScene']>,
    );
    const bakerDispose = vi.fn();
    const createBaker = vi.fn(
      () =>
        ({
          fromScene: bake,
          dispose: bakerDispose,
        }) as unknown as Pick<PMREMGenerator, 'fromScene' | 'dispose'>,
    );
    const material = new ShaderMaterial({ toneMapped: true });
    const materialVersion = material.version;
    const sky = new Mesh(new SphereGeometry(1, 3, 2), material);
    let stage = '';
    const steps = createLandEnvironmentSteps(
      {} as WebGLRenderer,
      sky,
      () => {},
      (nextStage) => {
        stage = nextStage;
      },
      createBaker,
    );

    expect(steps.next().done).toBe(false);
    expect(stage).toBe('environment:bake-0');
    expect(bake).toHaveBeenCalledTimes(1);
    expect(material.toneMapped).toBe(false);

    steps.return(undefined as unknown as LandEnvironmentHandle);

    expect(targetDispose).toHaveBeenCalledTimes(1);
    expect(bakerDispose).toHaveBeenCalledTimes(1);
    expect(material.toneMapped).toBe(true);
    expect(material.version).toBeGreaterThan(materialVersion);

    sky.geometry.dispose();
    material.dispose();
  });
});
