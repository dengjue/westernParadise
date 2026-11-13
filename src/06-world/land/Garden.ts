import type { Group } from 'three';
import type { QualityTier } from '@/00-types';
import { createGardenLayout } from '@/02-core';
import { createGardenWind } from '@/05-materials';
import type { PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';
import { createGardenTrees } from './GardenTrees';
import { createGardenLotuses } from './GardenLotus';

/** 创建时生成布局与实例，更新时只改变风时间；布局可供诊断和后续空间分块使用。 */
export function createGarden(
  root: Group,
  builder: LandBuilder,
  materials: PureLandMaterials,
  seed: number,
  quality: QualityTier,
  reducedMotion: boolean,
) {
  const layout = createGardenLayout(seed),
    wind = createGardenWind(reducedMotion);
  createGardenTrees(root, builder, materials, layout.trees, seed, quality, wind);
  createGardenLotuses(root, builder, materials, layout.lotuses, seed, quality, wind);
  // 远景白鸟保持静态剪影，与植物随机流独立。
  for (let i = 0; i < 9; i++) {
    const x = -40 + i * 5,
      y = 46 + Math.sin(i * 0.6) * 3,
      z = -105 - Math.abs(i - 4) * 3;
    for (const side of [-1, 1])
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
  }
  return { layout, wind, update: wind.update };
}
