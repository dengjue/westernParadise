import { Material, Texture } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasFactory, PureLandMaterials } from '../src/05-materials';
import { createPureLandMaterialsSteps } from '../src/05-materials';

function createCanvasFactory(): CanvasFactory {
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
      getImageData: (_x: number, _y: number, imageWidth: number, imageHeight: number) =>
        ({ data: new Uint8ClampedArray(imageWidth * imageHeight * 4) }) as ImageData,
      putImageData() {},
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
