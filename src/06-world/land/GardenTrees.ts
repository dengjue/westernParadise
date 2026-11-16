import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import type { Group } from 'three';
import type { QualityTier } from '@/00-types';
import { LAND_GARDEN, LAND_GARDEN_QUALITY } from '@/01-shared';
import { gardenRng, sampleGardenLeaf } from '@/02-core';
import type { GardenPoint, GardenTree } from '@/02-core';
import { applyGardenWind } from '@/05-materials';
import type { GardenWind, PureLandMaterials } from '@/05-materials';
import type { LandBuilder } from './Builder';
import { finishGardenInstancesSteps, treeLeafGeometry, windGeometry } from './GardenGeometry';
import { taperedTube } from './CraftGeometry';

function consume(steps: Generator<void, void, void>): void {
  while (!steps.next().done) {
    // Synchronous callers consume the same work units immediately.
  }
}

function* treeSkeletonSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  tree: GardenTree,
): Generator<void, void, void> {
  const config = LAND_GARDEN.trees,
    { x, z, height, lean } = tree,
    island = config.island;
  builder.box(m.stone, [x, island.stoneY, z], [6, island.stoneHeight, 6]);
  yield;
  builder.box(m.gold, [x, island.rimY, z], [island.halfWidth * 2, 0.12, island.halfWidth * 2]);
  yield;
  builder.box(m.jade, [x, island.topY, z], [5.5, 0.1, 5.5]);
  yield;
  const trunk = taperedTube(
    [
      [x, island.topY, z],
      [x + lean, height * 0.38, z],
      [x - lean * 0.6, height * 0.72, z + 0.22],
      [x, height * 0.98, z],
    ],
    [config.trunkRadius, config.trunkRadius * 0.88, config.trunkRadius * 0.5, config.twigRadius],
    12,
    6,
  );
  yield* builder.shapeOwnedSteps(trunk, m.goldDark);
  for (const branch of tree.branches) {
    const geometry = taperedTube(
      branch.points,
      [config.branchRadius * 1.3, config.branchRadius, config.twigRadius],
      8,
      5,
    );
    yield* builder.shapeOwnedSteps(geometry, m.goldDark);
    for (const twig of branch.twigs) {
      builder.rod(m.goldDark, twig.from, twig.to, config.twigRadius);
      yield;
    }
  }
}

/** 珠线两端连接真实枝端，不再用固定高度穿过树冠；珠粒用共享低面数球体。 */
function* pearlGarlandsSteps(
  builder: LandBuilder,
  m: PureLandMaterials,
  trees: readonly GardenTree[],
  seed: number,
  quality: QualityTier,
): Generator<void, void, void> {
  const config = LAND_GARDEN.pearls,
    detail = LAND_GARDEN_QUALITY[quality];
  const pearl = new SphereGeometry(1, detail.pearlSegments, detail.pearlSegments - 2);
  const anchor = (tree: GardenTree, direction: number): GardenPoint =>
    tree.branches.reduce((best, branch) => {
      const point = branch.points.at(-1)!;
      return point[2] * direction > best[2] * direction ? point : best;
    }, tree.branches[0]!.points.at(-1)!);
  try {
    for (const tree of trees) {
      if (tree.lane !== 1 || tree.row === LAND_GARDEN.trees.rows - 1) continue;
      const next = trees.find(
        (other) =>
          other.side === tree.side && other.lane === tree.lane && other.row === tree.row + 1,
      )!;
      const from = anchor(tree, 1),
        to = anchor(next, -1);
      const rng = gardenRng(seed, 'ornament', tree.id),
        sag = config.sag * rng.range(0.82, 1.15);
      const points: GardenPoint[] = [];
      for (let index = 0; index <= config.samples; index++) {
        const t = index / config.samples;
        const point: GardenPoint = [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t - Math.sin(Math.PI * t) * sag,
          from[2] + (to[2] - from[2]) * t,
        ];
        points.push(point);
        if (index % detail.pearlStep === 0) {
          builder.shape(pearl, m.pearl, point, [config.radius, config.radius, config.radius]);
          yield;
        }
      }
      builder.tube(m.gold, points, config.threadRadius, config.samples);
      yield;
      const middle = points[config.samples / 2]!;
      const drop: GardenPoint = [middle[0], middle[1] - 0.38, middle[2]];
      builder.rod(m.gold, middle, drop, config.threadRadius * 0.6);
      yield;
      builder.shape(pearl, m.pearl, drop, [config.radius, config.radius * 1.6, config.radius]);
      yield;
    }
  } finally {
    pearl.dispose();
  }
}

/** 稀疏冠团只写入缓存阴影：主视图与反射禁写颜色/深度，避免与细叶闪烁。 */
function* crownShadowSteps(root: Group, trees: readonly GardenTree[]): Generator<void, void, void> {
  const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const proxy = new InstancedMesh(
    new IcosahedronGeometry(1, 0),
    material,
    trees.length * LAND_GARDEN.trees.branches,
  );
  const transform = new Object3D();
  let index = 0;
  let attached = false;
  try {
    for (const tree of trees)
      for (const branch of tree.branches) {
        transform.position.fromArray(branch.points.at(-1)!);
        transform.position.y += 0.32;
        transform.scale.fromArray(LAND_GARDEN.trees.shadowScale);
        transform.updateMatrix();
        proxy.setMatrixAt(index++, transform.matrix);
        if (index % 32 === 0) yield;
      }
    proxy.name = 'garden-crown-shadow-proxy';
    proxy.castShadow = true;
    proxy.instanceMatrix.needsUpdate = true;
    proxy.computeBoundingBox();
    proxy.computeBoundingSphere();
    root.add(proxy);
    attached = true;
  } finally {
    if (!attached) {
      proxy.dispose();
      proxy.geometry.dispose();
      material.dispose();
    }
  }
}

export function* createGardenTreesSteps(
  root: Group,
  builder: LandBuilder,
  m: PureLandMaterials,
  trees: readonly GardenTree[],
  seed: number,
  quality: QualityTier,
  wind: GardenWind,
  onStage?: (stage: string) => void,
): Generator<void, void, void> {
  const detail = LAND_GARDEN_QUALITY[quality],
    config = LAND_GARDEN;
  onStage?.('garden:trees:allocate');
  const prototype = treeLeafGeometry(quality);
  const count = detail.leavesPerTree * trees.length;
  const geometry = windGeometry(prototype, count);
  prototype.dispose();
  applyGardenWind(m.leaf, wind);
  const leaves = new InstancedMesh(geometry, m.leaf, count);
  leaves.name = 'jewel-tree-leaves';
  leaves.receiveShadow = true;
  // 静态阴影不得缓存某一帧的风动细叶；由稳定冠团承担柔和的遮蔽关系。
  leaves.castShadow = false;
  const transform = new Object3D(),
    color = new Color(),
    attributes = geometry.getAttribute('gardenWind');
  let index = 0,
    attached = false;
  try {
    onStage?.('garden:trees:skeleton');
    for (const tree of trees) {
      yield* treeSkeletonSteps(builder, m, tree);
      onStage?.('garden:trees:instances');
      for (let leaf = 0; leaf < detail.leavesPerTree; leaf++) {
        const plan = sampleGardenLeaf(seed, tree, leaf);
        transform.position.fromArray(plan.point);
        transform.rotation.set(plan.pitch, plan.yaw, plan.roll, 'YXZ');
        transform.scale.set(plan.size * plan.width, plan.size, plan.size);
        transform.updateMatrix();
        leaves.setMatrixAt(index, transform.matrix);
        color.setHSL(plan.hue, plan.saturation, plan.lightness).convertSRGBToLinear();
        leaves.setColorAt(index, color);
        attributes.setXYZW(index++, config.wind.treeAngle, plan.phase, plan.weight, plan.frequency);
        if ((leaf + 1) % 64 === 0) yield;
      }
      onStage?.('garden:trees:skeleton');
    }
    onStage?.('garden:trees:bounds');
    yield* finishGardenInstancesSteps(leaves, config.wind.treeBounds);
    root.add(leaves);
    attached = true;
    yield;
    onStage?.('garden:trees:pearls');
    yield* pearlGarlandsSteps(builder, m, trees, seed, quality);
    if (detail.crownShadow) {
      onStage?.('garden:trees:crown-shadow');
      yield* crownShadowSteps(root, trees);
    }
  } finally {
    if (!attached) {
      leaves.dispose();
      leaves.geometry.dispose();
    }
  }
}

export function createGardenTrees(
  root: Group,
  builder: LandBuilder,
  m: PureLandMaterials,
  trees: readonly GardenTree[],
  seed: number,
  quality: QualityTier,
  wind: GardenWind,
): void {
  consume(createGardenTreesSteps(root, builder, m, trees, seed, quality, wind));
}
