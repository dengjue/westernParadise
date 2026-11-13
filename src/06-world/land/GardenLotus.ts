import { Color, CylinderGeometry, InstancedMesh, Object3D, SphereGeometry } from 'three';
import type { Group } from 'three';
import type { QualityTier } from '@/00-types';
import { LAND_GARDEN, LAND_GARDEN_QUALITY, PURE_LAND } from '@/01-shared';
import { gardenRng } from '@/02-core';
import type { GardenLotus } from '@/02-core';
import { applyGardenWind } from '@/05-materials';
import type { GardenWind, PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';
import {
  finishGardenInstances,
  lilyGeometry,
  lotusPetalGeometry,
  windGeometry,
} from './GardenGeometry';

/** 外层与内层保留完整轮廓，中间次级花瓣按稳定 ID 隔个抽样。 */
export function visiblePetal(layer: number, index: number, quality: QualityTier): boolean {
  return layer !== 1 || index % LAND_GARDEN_QUALITY[quality].secondaryPetalStep === 0;
}

export function createGardenLotuses(
  root: Group,
  builder: LandBuilder,
  m: PureLandMaterials,
  plans: readonly GardenLotus[],
  seed: number,
  quality: QualityTier,
  wind: GardenWind,
): void {
  const { lotus, lily, wind: motion } = LAND_GARDEN;
  const capacity = m.lotus.map(() => 0);
  for (const plan of plans)
    for (let layer = 0; layer < plan.petals.length; layer++) {
      for (let petal = 0; petal < plan.petals[layer]!; petal++) {
        if (visiblePetal(layer, petal, quality)) capacity[plan.color]!++;
      }
    }
  const prototype = lotusPetalGeometry(quality);
  const flowers = m.lotus.map((material, color) => {
    applyGardenWind(material, wind);
    const mesh = new InstancedMesh(
      windGeometry(prototype, capacity[color]!),
      material,
      capacity[color]!,
    );
    mesh.name = `lotus-petals-${color}`;
    mesh.receiveShadow = true;
    return mesh;
  });
  prototype.dispose();
  const leafPrototype = lilyGeometry(quality);
  const leafCount = plans.reduce((sum, flower) => sum + flower.leaves.length, 0);
  applyGardenWind(m.lily, wind);
  const leaves = new InstancedMesh(windGeometry(leafPrototype, leafCount), m.lily, leafCount);
  leafPrototype.dispose();
  leaves.name = 'lotus-leaves';
  leaves.receiveShadow = true;
  const center = new CylinderGeometry(1, 0.68, 1, 12),
    pollen = new SphereGeometry(1, 6, 4);
  const transform = new Object3D(),
    color = new Color();
  const counters = m.lotus.map(() => 0);
  let leafIndex = 0;
  for (const plan of plans) {
    const mesh = flowers[plan.color]!,
      y = PURE_LAND.waterY + plan.height;
    for (let layer = 0; layer < plan.petals.length; layer++) {
      const count = plan.petals[layer]!;
      for (let petal = 0; petal < count; petal++) {
        if (!visiblePetal(layer, petal, quality)) continue;
        const rng = gardenRng(seed, 'lotus', plan.id, 100 + layer * 32 + petal);
        const angle = plan.yaw + ((petal + layer * 0.41) / count) * Math.PI * 2;
        const size = plan.size * (1 - layer * lotus.petal.layerScale);
        transform.position.set(plan.x, y + layer * lotus.petal.layerHeight * plan.size, plan.z);
        transform.rotation.set(
          -(1 - plan.openness) * 0.95 - layer * 0.16,
          angle,
          rng.range(-0.035, 0.035),
          'YXZ',
        );
        transform.scale.set(size * rng.range(0.92, 1.08), size, size * rng.range(0.95, 1.04));
        transform.updateMatrix();
        const index = counters[plan.color]!++;
        mesh.setMatrixAt(index, transform.matrix);
        const tint = rng.range(0.9, 1.05);
        color.setRGB(tint, tint * 0.985, 1);
        mesh.setColorAt(index, color);
        mesh.geometry
          .getAttribute('gardenWind')
          .setXYZW(index, motion.petalAngle, plan.phase + petal * 0.17, 1 - layer * 0.15, 0.8);
      }
    }
    // 花心和茎保持固定，莲瓣仅在各自根部轻动，避免花心与整朵花分离。
    builder.rod(
      m.jade,
      [plan.x, PURE_LAND.waterY - 0.08, plan.z],
      [plan.x, y + 0.16 * plan.size, plan.z],
      lotus.stemRadius * plan.size,
    );
    builder.shape(
      center,
      m.gold,
      [plan.x, y + 0.18 * plan.size, plan.z],
      [lotus.centerRadius * plan.size, 0.16 * plan.size, lotus.centerRadius * plan.size],
    );
    for (let dot = 0; dot < lotus.pollenCount; dot += LAND_GARDEN_QUALITY[quality].pollenStep) {
      const angle = dot * 2.399963229728653,
        r = Math.sqrt(dot / lotus.pollenCount) * lotus.centerRadius * plan.size;
      builder.shape(
        pollen,
        m.goldDark,
        [plan.x + Math.cos(angle) * r, y + 0.27 * plan.size, plan.z + Math.sin(angle) * r],
        [lotus.pollenRadius, lotus.pollenRadius, lotus.pollenRadius],
      );
    }
    for (const leaf of plan.leaves) {
      transform.position.set(leaf.x, PURE_LAND.waterY + lily.height, leaf.z);
      transform.rotation.set(0, leaf.yaw, 0);
      transform.scale.setScalar(leaf.size);
      transform.updateMatrix();
      leaves.setMatrixAt(leafIndex, transform.matrix);
      const tint = 0.93 + Math.sin(leaf.phase) * 0.07;
      color.setRGB(tint, 0.98, tint);
      leaves.setColorAt(leafIndex, color);
      leaves.geometry
        .getAttribute('gardenWind')
        .setXYZW(leafIndex++, motion.lilyAngle, leaf.phase, 1, 0.6);
      builder.rod(
        m.jade,
        [leaf.x, PURE_LAND.waterY - 0.12, leaf.z],
        [leaf.x, PURE_LAND.waterY + lily.height, leaf.z],
        lotus.stemRadius * 0.7,
      );
    }
  }
  center.dispose();
  pollen.dispose();
  for (const flower of flowers) {
    finishGardenInstances(flower, motion.petalBounds);
    root.add(flower);
  }
  finishGardenInstances(leaves, motion.lilyBounds);
  root.add(leaves);
}
