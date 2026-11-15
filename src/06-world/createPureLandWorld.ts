import { Group } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import type { QualityTier, TimeOfDayId } from '@/00-types';
import { LAND_DETAIL_BY_QUALITY, LAND_RENDER } from '@/01-shared';
import { createHallPlaque, createPureLandMaterials } from '@/05-materials';
import type { CanvasFactory } from '@/05-materials';
import { createArchitecture } from './land/Architecture';
import { createLandAtmosphere } from './land/Atmosphere';
import { LandBuilder } from './land/Builder';
import { createGarden } from './land/Garden';
import { createSculptures } from './land/Sculpture';
import { createFlowerDrift } from './land/FlowerDrift';
import { partitionGarden } from './land/SpatialGarden';
import { createContactShadows } from './land/ContactShadows';
import { createEastRegionPrototype } from './land/RegionPrototype';

export interface PureLandWorldOptions {
  canvasFactory: CanvasFactory;
  renderer: WebGLRenderer;
  quality: QualityTier;
  seed: number;
  anisotropy: number;
  time: TimeOfDayId;
  reducedMotion: boolean;
  cellSize?: number;
  cellOrigin?: readonly [number, number];
  /** 只在第三人称阶段 3 原型启用，不改变默认四景点/第一人称场景。 */
  regionPrototype?: boolean;
}

export function createPureLandWorld(scene: Scene, options: PureLandWorldOptions) {
  const start = performance.now();
  const root = new Group();
  root.name = 'sukhavati';
  const materials = createPureLandMaterials(
    options.canvasFactory,
    options.seed,
    options.anisotropy,
  );
  const plaque = createHallPlaque(options.canvasFactory);
  const cellSize = options.cellSize ?? LAND_RENDER.cellSize;
  const builder = new LandBuilder({
    cellSize,
    cellOrigin: options.cellOrigin,
    dynamicLod: true,
    multiDraw: options.renderer.extensions.has('WEBGL_multi_draw'),
  });
  const detail = LAND_DETAIL_BY_QUALITY[options.quality];
  const materialsReady = performance.now();
  createArchitecture(builder, materials, plaque, detail);
  createSculptures(builder, materials, detail);
  const architectureReady = performance.now();
  const garden = createGarden(
    root,
    builder,
    materials,
    options.seed,
    options.quality,
    options.reducedMotion,
  );
  partitionGarden(root, garden.layout.trees, options.quality, cellSize, options.cellOrigin);
  const gardenReady = performance.now();
  builder.flush(root);
  const disposeRegionPrototype = options.regionPrototype
    ? createEastRegionPrototype(root, materials, cellSize)
    : undefined;
  createContactShadows(root, builder.contacts, options.canvasFactory);
  scene.add(root);
  const flowers = createFlowerDrift(root, options.seed, options.quality === 'low' ? 120 : 420);
  const batchesReady = performance.now();
  const atmosphere = createLandAtmosphere(
    scene,
    options.renderer,
    options.quality,
    options.time,
    options.reducedMotion,
  );
  scene.traverse((object) => {
    if (object.layers.isEnabled(LAND_RENDER.layers.main))
      object.layers.enable(LAND_RENDER.layers.reflection);
  });
  let elapsed = 0;
  return {
    root,
    startup: {
      materialsMs: materialsReady - start,
      architectureMs: architectureReady - materialsReady,
      gardenMs: gardenReady - architectureReady,
      batchesMs: batchesReady - gardenReady,
      atmosphereMs: performance.now() - batchesReady,
      curveCache: builder.cacheStats,
    },
    garden,
    reflection: atmosphere.reflection,
    lighting: atmosphere.stats,
    cellSize,
    setTime: atmosphere.setTime,
    update(deltaMs: number): void {
      elapsed += deltaMs / 1000;
      garden.update(elapsed);
      atmosphere.update(elapsed, deltaMs);
      flowers.update(elapsed);
    },
    dispose(): void {
      let firstError: unknown;
      let failed = false;
      try {
        atmosphere.dispose();
      } catch (error) {
        firstError = error;
        failed = true;
      }
      try {
        disposeRegionPrototype?.();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
      if (failed) throw firstError;
    },
  };
}
