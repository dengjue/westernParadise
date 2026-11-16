import type { Group } from 'three';
import type { QualityTier } from '@/00-types';
import { createGardenLayoutSteps } from '@/02-core';
import type { createGardenLayout } from '@/02-core';
import { createGardenWind } from '@/05-materials';
import type { PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';
import { createGardenTreesSteps } from './GardenTrees';
import { createGardenLotusesSteps } from './GardenLotus';

function consume<T>(steps: Generator<void, T, void>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** 创建时生成布局与实例，更新时只改变风时间；布局可供诊断和后续空间分块使用。 */
export function* createGardenSteps(
  root: Group,
  builder: LandBuilder,
  materials: PureLandMaterials,
  seed: number,
  quality: QualityTier,
  reducedMotion: boolean,
  onStage?: (stage: string) => void,
): Generator<
  void,
  {
    layout: ReturnType<typeof createGardenLayout>;
    wind: ReturnType<typeof createGardenWind>;
    update: ReturnType<typeof createGardenWind>['update'];
  },
  void
> {
  onStage?.('garden:layout');
  const layout = yield* createGardenLayoutSteps(seed);
  yield;
  const wind = createGardenWind(reducedMotion);
  onStage?.('garden:trees');
  yield* createGardenTreesSteps(
    root,
    builder,
    materials,
    layout.trees,
    seed,
    quality,
    wind,
    onStage,
  );
  yield* createGardenLotusesSteps(
    root,
    builder,
    materials,
    layout.lotuses,
    seed,
    quality,
    wind,
    onStage,
  );
  // 远景白鸟保持静态剪影，与植物随机流独立。
  onStage?.('garden:birds');
  for (let i = 0; i < 9; i++) {
    const x = -40 + i * 5,
      y = 46 + Math.sin(i * 0.6) * 3,
      z = -105 - Math.abs(i - 4) * 3;
    for (const side of [-1, 1]) {
      builder.tube(
        materials.pearl,
        [
          [x, y, z],
          [x + side * 0.8, y + 0.35, z + 0.1],
          [x + side * 1.9, y + 0.15, z + 0.6],
        ],
        0.075,
        8,
      );
      yield;
    }
  }
  return { layout, wind, update: wind.update };
}

export function createGarden(
  root: Group,
  builder: LandBuilder,
  materials: PureLandMaterials,
  seed: number,
  quality: QualityTier,
  reducedMotion: boolean,
) {
  return consume(createGardenSteps(root, builder, materials, seed, quality, reducedMotion));
}
