import { Group } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import type { QualityTier, TimeOfDayId } from '@/00-types';
import { LAND_DETAIL_BY_QUALITY } from '@/01-shared';
import { createHallPlaque, createPureLandMaterials } from '@/05-materials';
import type { CanvasFactory } from '@/05-materials';
import { createArchitecture } from './land/Architecture';
import { createLandAtmosphere } from './land/Atmosphere';
import { LandBuilder } from './land/Builder';
import { createGarden } from './land/Garden';
import { createSculptures } from './land/Sculpture';
import { createFlowerDrift } from './land/FlowerDrift';

export interface PureLandWorldOptions {
  canvasFactory: CanvasFactory;
  renderer: WebGLRenderer;
  quality: QualityTier;
  seed: number;
  anisotropy: number;
  time: TimeOfDayId;
}

export function createPureLandWorld(scene: Scene, options: PureLandWorldOptions) {
  const root = new Group();
  root.name = 'sukhavati';
  const materials = createPureLandMaterials(
    options.canvasFactory,
    options.seed,
    options.anisotropy,
  );
  const plaque = createHallPlaque(options.canvasFactory);
  const builder = new LandBuilder();
  const detail = LAND_DETAIL_BY_QUALITY[options.quality];
  createArchitecture(builder, materials, plaque, detail);
  createSculptures(builder, materials, detail);
  createGarden(root, builder, materials, options.seed, options.quality);
  builder.flush(root);
  scene.add(root);
  const flowers = createFlowerDrift(root, options.seed, options.quality === 'low' ? 120 : 420);
  const atmosphere = createLandAtmosphere(scene, options.renderer, options.quality, options.time);
  let elapsed = 0;
  return {
    root,
    setTime: atmosphere.setTime,
    update(deltaMs: number): void {
      elapsed += deltaMs / 1000;
      atmosphere.update(elapsed);
      flowers.update(elapsed);
    },
    dispose: atmosphere.dispose,
  };
}
