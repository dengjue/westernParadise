import { LAND_GARDEN } from '@/01-shared';
import { Rng } from './Rng';

export type GardenPoint = [number, number, number];
export interface GardenTwig {
  from: GardenPoint;
  to: GardenPoint;
  angle: number;
}
export interface GardenBranch {
  points: GardenPoint[];
  twigs: GardenTwig[];
}
export interface GardenTree {
  id: number;
  side: number;
  row: number;
  lane: number;
  x: number;
  z: number;
  height: number;
  radius: number;
  lean: number;
  branches: GardenBranch[];
}
export interface PondCircle {
  x: number;
  z: number;
  radius: number;
}
export interface GardenLily extends PondCircle {
  size: number;
  yaw: number;
  phase: number;
}
export interface GardenLotus extends PondCircle {
  id: number;
  size: number;
  openness: number;
  height: number;
  yaw: number;
  phase: number;
  color: number;
  petals: number[];
  leaves: GardenLily[];
}
interface GardenLayout {
  trees: GardenTree[];
  lotuses: GardenLotus[];
}

/** 不消费父随机流：增减一个对象的细节不会移动其他对象。所有运算限制在 32 位。 */
export function gardenRng(
  seed: number,
  stream: keyof typeof LAND_GARDEN.streams,
  id: number,
  part = 0,
): Rng {
  let hash =
    (seed ^
      LAND_GARDEN.streams[stream] ^
      Math.imul(id + 1, 0x9e3779b1) ^
      Math.imul(part + 1, 0x85ebca6b)) >>>
    0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return new Rng((hash ^ (hash >>> 16)) >>> 0);
}

function* createTreesSteps(seed: number): Generator<void, GardenTree[], void> {
  const config = LAND_GARDEN.trees,
    trees: GardenTree[] = [];
  for (const side of [-1, 1])
    for (let row = 0; row < config.rows; row++)
      for (let lane = 0; lane < config.lanes.length; lane++) {
        const id = trees.length,
          rng = gardenRng(seed, 'skeleton', id);
        const x = side * config.lanes[lane]!,
          z = config.startZ + row * config.spacing;
        const height = rng.range(...config.height),
          radius = rng.range(...config.radius),
          lean = rng.range(-0.42, 0.42);
        const rotation = rng.range(0, Math.PI * 2),
          branches: GardenBranch[] = [];
        for (let index = 0; index < config.branches; index++) {
          const branchRng = gardenRng(seed, 'skeleton', id, index + 1);
          const angle = rotation + index * 2.399963229728653; // 黄金角打散同一高度的整齐轮辐。
          const leader = index === config.branches - 1;
          const reach = radius * (leader ? config.leaderReach : branchRng.range(0.68, 1.0));
          const level = index % 3;
          const end: GardenPoint = [
            x + Math.cos(angle) * reach,
            height * (leader ? 1.02 : 0.72 + level * 0.105) + branchRng.range(-0.25, 0.25),
            z + Math.sin(angle) * reach,
          ];
          const points: GardenPoint[] = [
            [x + lean, height * (0.43 + level * 0.08), z],
            [x + Math.cos(angle) * reach * 0.53, end[1] - 0.7, z + Math.sin(angle) * reach * 0.53],
            end,
          ];
          const twigs: GardenTwig[] = [];
          for (let twig = 0; twig < config.twigs; twig++) {
            const yaw = angle + (twig - 1) * 0.72;
            const from: GardenPoint = [
              end[0] - Math.cos(angle) * 0.65,
              end[1] - 0.18,
              end[2] - Math.sin(angle) * 0.65,
            ];
            const to: GardenPoint = [
              end[0] + Math.cos(yaw) * 0.95,
              end[1] + branchRng.range(...config.twigRise),
              end[2] + Math.sin(yaw) * 0.95,
            ];
            twigs.push({ from, to, angle: yaw });
          }
          branches.push({ points, twigs });
        }
        trees.push({ id, side, row, lane, x, z, height, radius, lean, branches });
        yield;
      }
  return trees;
}

/** 圆形植物外包围与矩形岛台之间使用最近点距离，连同风动余量留出水隙。 */
export function isPondClear(circle: PondCircle, trees: readonly GardenTree[]): boolean {
  const { pond, trees: config } = LAND_GARDEN;
  const x = Math.abs(circle.x),
    radius = circle.radius + pond.clearance;
  if (
    x - radius < pond.minX ||
    x + radius > pond.maxX ||
    circle.z - radius < pond.minZ ||
    circle.z + radius > pond.maxZ
  )
    return false;
  return trees.every((tree) => {
    const dx = Math.max(0, Math.abs(circle.x - tree.x) - config.island.halfWidth);
    const dz = Math.max(0, Math.abs(circle.z - tree.z) - config.island.halfWidth);
    return Math.hypot(dx, dz) >= radius;
  });
}

function separated(circle: PondCircle, others: readonly PondCircle[]): boolean {
  return others.every(
    (other) =>
      Math.hypot(circle.x - other.x, circle.z - other.z) >=
      circle.radius + other.radius + LAND_GARDEN.pond.clearance,
  );
}

/** 主枝不依赖画质，叶片按稳定 ID 逐个派生；任意前缀均覆盖全部短枝。 */
export function sampleGardenLeaf(seed: number, tree: GardenTree, index: number) {
  const config = LAND_GARDEN.trees,
    rng = gardenRng(seed, 'leaf', tree.id, index);
  const branch = tree.branches[index % tree.branches.length]!;
  const twig = branch.twigs[Math.floor(index / tree.branches.length) % config.twigs]!;
  const t = rng.range(0.18, 1.0),
    offset = rng.range(-0.14, 0.14);
  const point: GardenPoint = [
    twig.from[0] + (twig.to[0] - twig.from[0]) * t + Math.sin(twig.angle) * offset,
    twig.from[1] + (twig.to[1] - twig.from[1]) * t + rng.range(-0.08, 0.08),
    twig.from[2] + (twig.to[2] - twig.from[2]) * t - Math.cos(twig.angle) * offset,
  ];
  return {
    point,
    pitch: rng.range(...config.leaf.pitch),
    yaw: twig.angle + rng.range(-1.2, 1.2),
    roll: rng.range(...config.leaf.roll),
    size: rng.range(...config.leaf.scale),
    width: rng.range(0.78, 1.13),
    hue: rng.range(...config.hue),
    saturation: rng.range(...config.saturation),
    lightness: rng.range(...config.lightness),
    phase: rng.range(0, Math.PI * 2),
    weight: 0.4 + t * 0.6,
    frequency: rng.range(0.72, 1.2),
  };
}

function* createLotusesSteps(
  seed: number,
  trees: readonly GardenTree[],
): Generator<void, GardenLotus[], void> {
  const { pond, lotus, lily, wind } = LAND_GARDEN;
  const flowers: GardenLotus[] = [];
  for (let id = 0; id < lotus.count; id++) {
    const rng = gardenRng(seed, 'lotus', id);
    const size = rng.range(...lotus.size),
      openness = rng.range(...lotus.openness);
    const flower: GardenLotus = {
      id,
      x: 0,
      z: 0,
      radius: size * lotus.footprint + wind.petalBounds,
      size,
      openness,
      height: rng.range(...lotus.stemHeight),
      yaw: rng.range(0, Math.PI * 2),
      phase: rng.range(0, Math.PI * 2),
      color: id < lotus.anchors.length ? id : Math.floor(id / 2) % lotus.colors.length,
      petals: lotus.petalCounts.map((count) => count + rng.int(-1, 2)),
      leaves: [],
    };
    let placed = false;
    for (let attempt = 0; attempt < pond.attempts; attempt++) {
      const anchor = attempt === 0 ? lotus.anchors[id] : undefined;
      flower.x = anchor?.[0] ?? (id % 2 === 0 ? -1 : 1) * rng.range(pond.minX, pond.maxX);
      flower.z = anchor?.[1] ?? rng.range(pond.minZ, pond.maxZ);
      if (isPondClear(flower, trees) && separated(flower, flowers)) {
        placed = true;
        break;
      }
      if ((attempt + 1) % 32 === 0) yield;
    }
    if (!placed) throw new Error(`莲花 ${id} 无法在池内留出安全水隙`);
    flowers.push(flower);
    yield;
  }
  const occupied: PondCircle[] = [...flowers];
  for (const flower of flowers)
    for (let index = 0; index < lily.perFlower; index++) {
      const rng = gardenRng(seed, 'lily', flower.id, index),
        size = rng.range(...lily.size);
      const leaf: GardenLily = {
        x: 0,
        z: 0,
        radius: size * lily.footprint + wind.lilyBounds,
        size,
        yaw: rng.range(0, Math.PI * 2),
        phase: rng.range(0, Math.PI * 2),
      };
      let placed = false;
      for (let attempt = 0; attempt < pond.attempts; attempt++) {
        const angle = rng.range(0, Math.PI * 2),
          distance = flower.radius + leaf.radius + rng.range(0.25, 1.3);
        leaf.x =
          attempt < 24
            ? flower.x + Math.cos(angle) * distance
            : Math.sign(flower.x) * rng.range(pond.minX, pond.maxX);
        leaf.z =
          attempt < 24 ? flower.z + Math.sin(angle) * distance : rng.range(pond.minZ, pond.maxZ);
        if (isPondClear(leaf, trees) && separated(leaf, occupied)) {
          placed = true;
          break;
        }
        if ((attempt + 1) % 32 === 0) yield;
      }
      if (!placed) throw new Error(`莲叶 ${flower.id}/${index} 无法在池内留出安全水隙`);
      flower.leaves.push(leaf);
      occupied.push(leaf);
      yield;
    }
  return flowers;
}

/** 与渲染器无关的完整园林骨架；不接受质量参数，从接口上杜绝切档位移。 */
/** 确定性园林布局；大对象放置分步让帧，失败候选搜索也有界让出。 */
export function* createGardenLayoutSteps(seed: number): Generator<void, GardenLayout, void> {
  const trees = yield* createTreesSteps(seed);
  const lotuses = yield* createLotusesSteps(seed, trees);
  return { trees, lotuses };
}

export function createGardenLayout(seed: number): GardenLayout {
  const steps = createGardenLayoutSteps(seed);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
