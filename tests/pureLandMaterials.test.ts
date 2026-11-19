import { Material, MeshStandardMaterial, Texture } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAND_ATMOSPHERE, LAND_PMREM_ATLAS } from '../src/01-shared';
import { Rng } from '../src/02-core';
import type { CanvasFactory, PureLandMaterials } from '../src/05-materials';
import { createPureLandMaterialsSteps } from '../src/05-materials';

function createCanvasFactory(onPutImageData?: (image: ImageData) => void): CanvasFactory {
  return (width, height) => {
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      lineCap: 'butt',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      fillRect() {},
      strokeRect() {},
      createImageData: (imageWidth: number, imageHeight: number) =>
        ({
          width: imageWidth,
          height: imageHeight,
          data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
        }) as ImageData,
      getImageData: (_x: number, _y: number, imageWidth: number, imageHeight: number) =>
        ({ data: new Uint8ClampedArray(imageWidth * imageHeight * 4) }) as ImageData,
      putImageData: (image: ImageData) => onPutImageData?.(image),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      beginPath() {},
      moveTo() {},
      lineTo() {},
      bezierCurveTo() {},
      quadraticCurveTo() {},
      arc() {},
      stroke() {},
      fill() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      fillText() {},
    };
    return {
      width,
      height,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
  };
}

describe('createPureLandMaterialsSteps cancellation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps every bundled PBR material above the first retained atlas mip threshold', () => {
    const steps = createPureLandMaterialsSteps(createCanvasFactory(), 789, 1);
    let result = steps.next();
    while (!result.done) result = steps.next();

    const values = Object.values(result.value).flatMap((value) =>
      Array.isArray(value) ? value : [value],
    );
    const pbrMaterials = values.filter(
      (value): value is MeshStandardMaterial => value instanceof MeshStandardMaterial,
    );
    const maxSourceLod = Math.log2(LAND_ATMOSPHERE.environment.size / LAND_PMREM_ATLAS.minMipSize);
    const firstRetainedSourceLod = Math.log2(
      LAND_ATMOSPHERE.environment.size / LAND_PMREM_ATLAS.maxMipSize,
    );
    const roughnessAtFirstRetainedMip = 1 - Math.sqrt(1 - firstRetainedSourceLod / maxSourceLod);
    const minimumRoughness = Math.min(...pbrMaterials.map((material) => material.roughness));

    expect(pbrMaterials.length).toBeGreaterThan(0);
    expect(minimumRoughness).toBeCloseTo(0.22, 6);
    expect(minimumRoughness).toBeGreaterThan(roughnessAtFirstRetainedMip);

    const textures = new Set<Texture>();
    for (const value of values) {
      if (!(value instanceof Material)) continue;
      value.dispose();
      for (const property of Object.values(value))
        if (property instanceof Texture) textures.add(property);
    }
    for (const texture of textures) texture.dispose();
  });

  it('writes the same seeded stone variation directly into each pixel chunk', () => {
    let firstChunk: Uint8ClampedArray | undefined;
    const steps = createPureLandMaterialsSteps(
      createCanvasFactory((image) => {
        firstChunk ??= new Uint8ClampedArray(image.data);
      }),
      123,
      1,
    );

    expect(steps.next().done).toBe(false);
    const rng = new Rng(123);
    const expected = new Uint8ClampedArray(firstChunk!.length);
    for (let pixel = 0; pixel < expected.length; pixel += 4) {
      const variation = rng.range(-13, 13);
      expected[pixel] = 225 + variation;
      expected[pixel + 1] = 222 + variation;
      expected[pixel + 2] = 211 + variation;
      expected[pixel + 3] = 255;
    }

    expect(firstChunk).toEqual(expected);
    steps.return(undefined as unknown as PureLandMaterials);
  });

  it('disposes generated textures when cancelled during a later texture raster', () => {
    let stage = '';
    const textureDispose = vi.spyOn(Texture.prototype, 'dispose');
    const steps = createPureLandMaterialsSteps(createCanvasFactory(), 123, 1, (nextStage) => {
      stage = nextStage;
    });

    let next = steps.next();
    while (!next.done && stage !== 'materials:carvedStone:pixels') next = steps.next();
    expect(next.done).toBe(false);
    expect(stage).toBe('materials:carvedStone:pixels');

    steps.return(undefined as unknown as PureLandMaterials);

    expect(textureDispose).toHaveBeenCalled();
  });

  it('disposes assembled materials and textures before ownership is transferred', () => {
    let stage = '';
    const disposedMaterials = new Set<Material>();
    const materialDispose = vi.spyOn(Material.prototype, 'dispose').mockImplementation(function (
      this: Material,
    ) {
      disposedMaterials.add(this);
    });
    const textureDispose = vi.spyOn(Texture.prototype, 'dispose');
    const steps = createPureLandMaterialsSteps(createCanvasFactory(), 456, 1, (nextStage) => {
      stage = nextStage;
    });

    let next = steps.next();
    while (!next.done && stage !== 'materials:assemble') next = steps.next();
    expect(next.done).toBe(false);
    expect(stage).toBe('materials:assemble');

    steps.return(undefined as unknown as PureLandMaterials);

    expect(materialDispose).toHaveBeenCalled();
    expect(disposedMaterials.size).toBeGreaterThan(0);
    expect(textureDispose).toHaveBeenCalled();
  });
});
