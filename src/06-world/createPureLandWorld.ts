import { Group, Material } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import type { QualityTier, TimeOfDayId } from '@/00-types';
import { LAND_DETAIL_BY_QUALITY, LAND_RENDER } from '@/01-shared';
import { createHallPlaque, createPureLandMaterials } from '@/05-materials';
import type { CanvasFactory, PureLandMaterials } from '@/05-materials';
import { disposeObjectTree } from '@/04-engine';
import type { LandCellCameraPose } from '@/02-core';
import { createArchitectureSteps } from './land/Architecture';
import { createLandAtmosphere } from './land/Atmosphere';
import { LandBuilder } from './land/Builder';
import { createGardenSteps } from './land/Garden';
import { createSculpturesSteps } from './land/Sculpture';
import { createFlowerDrift } from './land/FlowerDrift';
import { partitionGardenSteps } from './land/SpatialGarden';
import { createContactShadows } from './land/ContactShadows';
import { createEastRegionCellStream } from './land/EastRegionCellStream';

type GardenResult =
  ReturnType<typeof createGardenSteps> extends Generator<void, infer T, void> ? T : never;

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
  /** 只在第三人称区域原型启用东区 cell 调度，不改变默认四景点/第一人称场景。 */
  regionPrototype?: boolean;
}

function ownedMaterials(
  materials: PureLandMaterials | undefined,
  plaque: Material | undefined,
): Material[] {
  const owned = plaque ? [plaque] : [];
  if (!materials) return owned;
  for (const value of Object.values(materials))
    for (const material of Array.isArray(value) ? value : [value])
      if (material instanceof Material) owned.push(material);
  return owned;
}

function createWorldHandle(
  root: Group,
  start: number,
  materialsReady: number,
  architectureReady: number,
  gardenReady: number,
  batchesReady: number,
  builder: LandBuilder,
  garden: GardenResult,
  atmosphere: ReturnType<typeof createLandAtmosphere>,
  cellSize: number,
  eastCellStream: ReturnType<typeof createEastRegionCellStream> | undefined,
  flowers: ReturnType<typeof createFlowerDrift>,
  options: PureLandWorldOptions,
) {
  let elapsed = 0;
  let disposed = false;
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
    get cellStreaming() {
      return eastCellStream?.snapshot() ?? null;
    },
    update(deltaMs: number, cellPose?: LandCellCameraPose | null): void {
      if (disposed) return;
      eastCellStream?.update(cellPose ?? null, deltaMs);
      if (options.reducedMotion) return;
      elapsed += deltaMs / 1000;
      garden.update(elapsed);
      atmosphere.update(elapsed, deltaMs);
      flowers.update(elapsed);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      let firstError: unknown;
      let failed = false;
      try {
        atmosphere.dispose();
      } catch (error) {
        firstError = error;
        failed = true;
      }
      try {
        eastCellStream?.dispose();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
      if (failed) throw firstError;
    },
  };
}

/** 同步基线路径与第三人称分帧路径消费同一组确定性构建步骤。 */
export function* createPureLandWorldSteps(
  scene: Scene,
  options: PureLandWorldOptions,
): Generator<void, ReturnType<typeof createWorldHandle>, void> {
  const start = performance.now();
  const root = new Group();
  root.name = 'sukhavati';
  const sceneState = {
    fog: scene.fog,
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
  };
  let materials: PureLandMaterials | undefined;
  let plaque: Material | undefined;
  let builder: LandBuilder | undefined;
  let eastCellStream: ReturnType<typeof createEastRegionCellStream> | undefined;
  let atmosphere: ReturnType<typeof createLandAtmosphere> | undefined;
  let atmosphereChildren: Set<(typeof scene.children)[number]> | undefined;
  let materialsReady: number;
  let architectureReady: number;
  let gardenReady: number;
  let batchesReady: number;
  let attached = false;
  let completed = false;
  const cellSize = options.cellSize ?? LAND_RENDER.cellSize;

  try {
    const worldMaterials = createPureLandMaterials(
      options.canvasFactory,
      options.seed,
      options.anisotropy,
    );
    materials = worldMaterials;
    const hallPlaque = createHallPlaque(options.canvasFactory);
    plaque = hallPlaque;
    materialsReady = performance.now();
    yield;

    const worldBuilder = new LandBuilder({
      cellSize,
      cellOrigin: options.cellOrigin,
      dynamicLod: true,
      multiDraw: options.renderer.extensions.has('WEBGL_multi_draw'),
    });
    builder = worldBuilder;
    const detail = LAND_DETAIL_BY_QUALITY[options.quality];
    yield* createArchitectureSteps(worldBuilder, worldMaterials, hallPlaque, detail);
    yield* createSculpturesSteps(worldBuilder, worldMaterials, detail);
    architectureReady = performance.now();

    const gardenResult = yield* createGardenSteps(
      root,
      worldBuilder,
      worldMaterials,
      options.seed,
      options.quality,
      options.reducedMotion,
    );
    yield* partitionGardenSteps(
      root,
      gardenResult.layout.trees,
      options.quality,
      cellSize,
      options.cellOrigin,
    );
    gardenReady = performance.now();

    yield* worldBuilder.flushSteps(root);
    eastCellStream = options.regionPrototype
      ? createEastRegionCellStream(root, worldMaterials, cellSize)
      : undefined;
    createContactShadows(root, worldBuilder.contacts, options.canvasFactory);
    const flowerDrift = createFlowerDrift(
      root,
      options.seed,
      options.quality === 'low' ? 120 : 420,
    );
    batchesReady = performance.now();
    yield;

    scene.add(root);
    attached = true;
    atmosphereChildren = new Set(scene.children);
    const landAtmosphere = createLandAtmosphere(
      scene,
      options.renderer,
      options.quality,
      options.time,
      options.reducedMotion,
    );
    atmosphere = landAtmosphere;
    yield;
    scene.traverse((object) => {
      if (object.layers.isEnabled(LAND_RENDER.layers.main))
        object.layers.enable(LAND_RENDER.layers.reflection);
    });

    const world = createWorldHandle(
      root,
      start,
      materialsReady,
      architectureReady,
      gardenReady,
      batchesReady,
      worldBuilder,
      gardenResult,
      landAtmosphere,
      cellSize,
      eastCellStream,
      flowerDrift,
      options,
    );
    completed = true;
    return world;
  } finally {
    if (!completed) {
      try {
        builder?.abort();
      } catch {
        // Continue releasing the remaining scene-owned resources.
      }
      try {
        eastCellStream?.dispose();
      } catch {
        // Continue releasing the remaining scene-owned resources.
      }
      try {
        atmosphere?.dispose();
      } catch {
        // Continue releasing the remaining scene-owned resources.
      }
      if (atmosphereChildren) {
        for (const child of [...scene.children]) {
          if (atmosphereChildren.has(child)) continue;
          scene.remove(child);
          try {
            disposeObjectTree(child);
          } catch {
            // Continue releasing the remaining scene-owned resources.
          }
        }
      }
      scene.fog = sceneState.fog;
      scene.environment = sceneState.environment;
      scene.environmentIntensity = sceneState.environmentIntensity;
      if (attached) root.removeFromParent();
      try {
        disposeObjectTree(root, ownedMaterials(materials, plaque));
      } catch {
        // Cancellation must not strand other resources if a disposer throws.
      }
    }
  }
}

export function createPureLandWorld(scene: Scene, options: PureLandWorldOptions) {
  const steps = createPureLandWorldSteps(scene, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
