import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Scene } from 'three';
import { Rng } from '@/02-core';
import { WORLD } from '@/01-shared';
import { createCourtyardMaterials } from '@/05-materials';
import type { CanvasFactory, CourtyardMaterials } from '@/05-materials';

export interface CourtyardWorldOptions {
  readonly canvasFactory: CanvasFactory;
  readonly seed: number;
  readonly anisotropy: number;
}

export interface WorldHandle {
  readonly root: Group;
  /** M1 场景没有持续动画，保留统一接口以便后续加入低刺激环境动效。 */
  update(deltaMs: number): void;
}

function markMesh<T extends Mesh>(
  mesh: T,
  name: string,
  castShadow = false,
  receiveShadow = true,
): T {
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

function addBox(
  parent: Group,
  name: string,
  width: number,
  height: number,
  depth: number,
  material: CourtyardMaterials[keyof CourtyardMaterials],
  x: number,
  y: number,
  z: number,
  castShadow = false,
): Mesh {
  const mesh = markMesh(
    new Mesh(new BoxGeometry(width, height, depth), material),
    name,
    castShadow,
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: Group,
  name: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
  material: CourtyardMaterials[keyof CourtyardMaterials],
  x: number,
  y: number,
  z: number,
  castShadow = false,
): Mesh {
  const mesh = markMesh(
    new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments), material),
    name,
    castShadow,
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function createGround(root: Group, materials: CourtyardMaterials): void {
  const ground = markMesh(
    new Mesh(new PlaneGeometry(WORLD.courtyard.width, WORLD.courtyard.depth), materials.ground),
    'courtyard-ground',
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = WORLD.ground.baseHeight;
  root.add(ground);

  for (const [index, area] of WORLD.scene.paving.entries()) {
    const paving = markMesh(
      new Mesh(new PlaneGeometry(area.maxX - area.minX, area.maxZ - area.minZ), materials.paving),
      `courtyard-paving-${index}`,
    );
    paving.rotation.x = -Math.PI / 2;
    paving.position.set((area.minX + area.maxX) / 2, area.y, (area.minZ + area.maxZ) / 2);
    root.add(paving);
  }

  const platform = WORLD.scene.platform;
  const platformHeight = platform.height - WORLD.ground.baseHeight;
  const platformMesh = markMesh(
    new Mesh(
      new BoxGeometry(platform.maxX - platform.minX, platformHeight, platform.maxZ - platform.minZ),
      materials.platform,
    ),
    'main-platform',
    false,
  );
  platformMesh.position.set(
    (platform.minX + platform.maxX) / 2,
    WORLD.ground.baseHeight + platformHeight / 2,
    (platform.minZ + platform.maxZ) / 2,
  );
  root.add(platformMesh);
}

function createWalls(root: Group, materials: CourtyardMaterials): void {
  const { bounds, courtyard, collision, player, scene } = WORLD;
  const innerWest = bounds.minX - player.capsule.radius;
  const innerEast = bounds.maxX + player.capsule.radius;
  const innerNorth = bounds.minZ - player.capsule.radius;
  const innerSouth = bounds.maxZ + player.capsule.radius;
  const wallThickness = collision.wallThickness;
  const wallY = WORLD.ground.baseHeight + scene.wall.height / 2;
  const capY = WORLD.ground.baseHeight + scene.wall.height + scene.wall.capHeight / 2;

  addBox(
    root,
    'wall-west',
    wallThickness,
    scene.wall.height,
    courtyard.depth + wallThickness * 2,
    materials.wall,
    innerWest - wallThickness / 2,
    wallY,
    0,
  );
  addBox(
    root,
    'wall-east',
    wallThickness,
    scene.wall.height,
    courtyard.depth + wallThickness * 2,
    materials.wall,
    innerEast + wallThickness / 2,
    wallY,
    0,
  );
  addBox(
    root,
    'wall-north',
    courtyard.width,
    scene.wall.height,
    wallThickness,
    materials.wall,
    0,
    wallY,
    innerNorth - wallThickness / 2,
  );
  const southSegmentWidth = (courtyard.width - scene.wall.gateWidth) / 2;
  const southSegmentOffset = scene.wall.gateWidth / 2 + southSegmentWidth / 2;
  addBox(
    root,
    'wall-south-west',
    southSegmentWidth,
    scene.wall.height,
    wallThickness,
    materials.wall,
    -southSegmentOffset,
    wallY,
    innerSouth + wallThickness / 2,
  );
  addBox(
    root,
    'wall-south-east',
    southSegmentWidth,
    scene.wall.height,
    wallThickness,
    materials.wall,
    southSegmentOffset,
    wallY,
    innerSouth + wallThickness / 2,
  );

  addBox(
    root,
    'wall-cap-west',
    scene.wall.capWidth,
    scene.wall.capHeight,
    courtyard.depth + wallThickness * 2,
    materials.tile,
    innerWest - wallThickness / 2,
    capY,
    0,
  );
  addBox(
    root,
    'wall-cap-east',
    scene.wall.capWidth,
    scene.wall.capHeight,
    courtyard.depth + wallThickness * 2,
    materials.tile,
    innerEast + wallThickness / 2,
    capY,
    0,
  );
  addBox(
    root,
    'wall-cap-north',
    courtyard.width + wallThickness,
    scene.wall.capHeight,
    scene.wall.capWidth,
    materials.tile,
    0,
    capY,
    innerNorth - wallThickness / 2,
  );
  addBox(
    root,
    'wall-cap-south-west',
    southSegmentWidth + wallThickness,
    scene.wall.capHeight,
    scene.wall.capWidth,
    materials.tile,
    -southSegmentOffset,
    capY,
    innerSouth + wallThickness / 2,
  );
  addBox(
    root,
    'wall-cap-south-east',
    southSegmentWidth + wallThickness,
    scene.wall.capHeight,
    scene.wall.capWidth,
    materials.tile,
    southSegmentOffset,
    capY,
    innerSouth + wallThickness / 2,
  );
}

function createFigure(
  parent: Group,
  index: number,
  x: number,
  z: number,
  scale: number,
  materials: CourtyardMaterials,
): void {
  const figureConfig = WORLD.scene.figure;
  const figure = new Group();
  figure.name = `static-figure-${index}`;
  figure.position.set(x, WORLD.scene.platform.height, z);
  figure.scale.setScalar(scale);

  const pedestal = markMesh(
    new Mesh(
      new CylinderGeometry(
        figureConfig.pedestalTopRadius,
        figureConfig.pedestalBottomRadius,
        figureConfig.pedestalHeight,
        figureConfig.pedestalSegments,
      ),
      materials.figurePedestal,
    ),
    `figure-${index}-pedestal`,
    false,
  );
  pedestal.position.y = figureConfig.pedestalHeight / 2;

  const body = markMesh(
    new Mesh(
      new ConeGeometry(figureConfig.bodyRadius, figureConfig.bodyHeight, figureConfig.bodySegments),
      materials.figureBody,
    ),
    `figure-${index}-body`,
    true,
  );
  body.position.y = figureConfig.pedestalHeight + figureConfig.bodyHeight / 2;

  const head = markMesh(
    new Mesh(
      new SphereGeometry(
        figureConfig.headRadius,
        figureConfig.headWidthSegments,
        figureConfig.headHeightSegments,
      ),
      materials.figureHead,
    ),
    `figure-${index}-head`,
    true,
  );
  head.position.y = figureConfig.headY;

  const accent = markMesh(
    new Mesh(
      new TorusGeometry(
        figureConfig.accentRadius,
        figureConfig.accentTube,
        figureConfig.accentRadialSegments,
        figureConfig.accentTubularSegments,
      ),
      materials.figureAccent,
    ),
    `figure-${index}-accent`,
    false,
  );
  accent.position.set(0, figureConfig.accentY, figureConfig.accentZ);

  figure.add(pedestal, body, head, accent);
  parent.add(figure);
}

function createHall(root: Group, materials: CourtyardMaterials): void {
  const hall = WORLD.scene.hall;
  const baseY = WORLD.scene.platform.height;
  const wallTop = baseY + hall.wallHeight;
  const backZ = hall.centerZ - hall.depth / 2;
  const frontZ = hall.centerZ + hall.depth / 2;
  const halfWidth = hall.width / 2;

  addBox(
    root,
    'main-hall-back-wall',
    hall.width,
    hall.wallHeight,
    hall.wallThickness,
    materials.plaster,
    0,
    baseY + hall.wallHeight / 2,
    backZ,
  );
  addBox(
    root,
    'main-hall-west-wall',
    hall.wallThickness,
    hall.wallHeight,
    hall.depth,
    materials.plaster,
    -halfWidth + hall.wallThickness / 2,
    baseY + hall.wallHeight / 2,
    hall.centerZ,
  );
  addBox(
    root,
    'main-hall-east-wall',
    hall.wallThickness,
    hall.wallHeight,
    hall.depth,
    materials.plaster,
    halfWidth - hall.wallThickness / 2,
    baseY + hall.wallHeight / 2,
    hall.centerZ,
  );

  addBox(
    root,
    'main-hall-front-beam',
    hall.width + hall.roofEave * 2,
    hall.beamHeight,
    hall.beamDepth,
    materials.wood,
    0,
    wallTop - 0.1,
    frontZ + hall.beamFrontOffset,
    true,
  );
  addBox(
    root,
    'main-hall-back-beam',
    hall.width + hall.roofEave * 2,
    hall.beamHeight,
    hall.beamDepth,
    materials.wood,
    0,
    wallTop - 0.1,
    backZ - hall.beamBackOffset,
    true,
  );

  for (const [index, x] of hall.columnXs.entries()) {
    addCylinder(
      root,
      `main-hall-column-${index}`,
      hall.columnRadius,
      hall.columnRadius * 1.05,
      hall.columnHeight,
      hall.columnSegments,
      materials.wood,
      x,
      baseY + hall.columnHeight / 2,
      hall.frontZ,
      true,
    );
    addCylinder(
      root,
      `main-hall-column-base-${index}`,
      hall.columnRadius * hall.columnBaseTopScale,
      hall.columnRadius * hall.columnBaseBottomScale,
      hall.columnBaseHeight,
      hall.columnSegments,
      materials.platform,
      x,
      baseY + hall.columnBaseHeight / 2,
      hall.frontZ,
    );
    addCylinder(
      root,
      `main-hall-column-cap-${index}`,
      hall.columnRadius * hall.columnCapTopScale,
      hall.columnRadius * hall.columnCapBottomScale,
      hall.columnCapHeight,
      hall.columnSegments,
      materials.wood,
      x,
      baseY + hall.columnHeight - hall.columnCapHeight / 2,
      hall.frontZ,
    );
  }

  const bracket = hall.bracket;
  for (const [index, x] of hall.columnXs.entries()) {
    const bracketBaseY = baseY + hall.columnHeight - bracket.baseOffset;
    addBox(
      root,
      `main-hall-bracket-${index}-lower`,
      bracket.lowerWidth,
      bracket.layerHeight,
      bracket.lowerDepth,
      materials.wood,
      x,
      bracketBaseY,
      hall.frontZ,
      true,
    );
    addBox(
      root,
      `main-hall-bracket-${index}-middle`,
      bracket.middleWidth,
      bracket.layerHeight,
      bracket.middleDepth,
      materials.wood,
      x,
      bracketBaseY + bracket.layerGap,
      hall.frontZ,
      true,
    );
    addBox(
      root,
      `main-hall-bracket-${index}-upper`,
      bracket.upperWidth,
      bracket.layerHeight,
      bracket.upperDepth,
      materials.wood,
      x,
      bracketBaseY + bracket.layerGap * 2,
      hall.frontZ,
      true,
    );
  }

  const roofHalfSpan = halfWidth + hall.roofEave;
  const roofSlopeLength = Math.hypot(roofHalfSpan, hall.roofRise);
  const roofPitch = Math.atan2(hall.roofRise, roofHalfSpan);
  const roofCenterY = wallTop + hall.roofRise / 2;
  const leftRoof = addBox(
    root,
    'main-hall-roof-left',
    roofSlopeLength,
    hall.roofThickness,
    hall.roofDepth,
    materials.tile,
    -roofHalfSpan / 2,
    roofCenterY,
    hall.centerZ,
  );
  leftRoof.rotation.z = roofPitch;
  const rightRoof = addBox(
    root,
    'main-hall-roof-right',
    roofSlopeLength,
    hall.roofThickness,
    hall.roofDepth,
    materials.tile,
    roofHalfSpan / 2,
    roofCenterY,
    hall.centerZ,
  );
  rightRoof.rotation.z = -roofPitch;
  addBox(
    root,
    'main-hall-roof-ridge',
    hall.roofRidgeWidth,
    hall.roofRidgeHeight,
    hall.roofDepth,
    materials.tile,
    0,
    wallTop + hall.roofRise + hall.roofRidgeOffset,
    hall.centerZ,
  );

  for (const [index, figure] of WORLD.scene.figures.entries()) {
    createFigure(root, index, figure.x, figure.z, figure.scale, materials);
  }
}

function createTree(
  root: Group,
  index: number,
  x: number,
  z: number,
  height: number,
  radius: number,
  materials: CourtyardMaterials,
): void {
  const shape = WORLD.scene.vegetationShape.tree;
  const tree = new Group();
  tree.name = `courtyard-tree-${index}`;
  tree.position.set(x, WORLD.ground.baseHeight, z);
  addCylinder(
    tree,
    `tree-${index}-trunk`,
    radius * shape.trunkTopScale,
    radius * shape.trunkBottomScale,
    height * shape.trunkHeightScale,
    shape.trunkSegments,
    materials.wood,
    0,
    (height * shape.trunkHeightScale) / 2,
    0,
  );

  const lowerCanopy = markMesh(
    new Mesh(
      new ConeGeometry(radius, height * shape.lowerCanopyHeightScale, shape.lowerCanopySegments),
      materials.leaf,
    ),
    `tree-${index}-lower-canopy`,
    true,
  );
  lowerCanopy.position.y = height * shape.lowerCanopyYScale;
  const upperCanopy = markMesh(
    new Mesh(
      new ConeGeometry(
        radius * shape.upperCanopyRadiusScale,
        height * shape.upperCanopyHeightScale,
        shape.upperCanopySegments,
      ),
      materials.leaf,
    ),
    `tree-${index}-upper-canopy`,
    true,
  );
  upperCanopy.position.y = height * shape.upperCanopyYScale;
  tree.add(lowerCanopy, upperCanopy);
  root.add(tree);
}

function createBamboo(
  root: Group,
  index: number,
  x: number,
  z: number,
  height: number,
  radius: number,
  materials: CourtyardMaterials,
): void {
  const shape = WORLD.scene.vegetationShape.bamboo;
  const bamboo = new Group();
  bamboo.name = `courtyard-bamboo-${index}`;
  bamboo.position.set(x, WORLD.ground.baseHeight, z);
  for (let stalk = 0; stalk < shape.stalkCount; stalk += 1) {
    const offset = (stalk - (shape.stalkCount - 1) / 2) * radius * shape.offsetScale;
    const stalkHeight = height * (shape.heightBaseScale + stalk * shape.heightStepScale);
    addCylinder(
      bamboo,
      `bamboo-${index}-stalk-${stalk}`,
      radius * shape.topRadiusScale,
      radius * shape.bottomRadiusScale,
      stalkHeight,
      shape.stalkSegments,
      materials.wood,
      offset,
      stalkHeight / 2,
      offset * 0.45,
      true,
    );
    const leaf = markMesh(
      new Mesh(
        new ConeGeometry(
          radius * shape.crownRadiusScale,
          height * shape.crownHeightScale,
          shape.crownSegments,
        ),
        materials.leaf,
      ),
      `bamboo-${index}-crown-${stalk}`,
      true,
    );
    leaf.position.set(offset, stalkHeight * shape.crownYScale, offset * shape.crownZScale);
    bamboo.add(leaf);
  }
  root.add(bamboo);
}

function createVegetation(root: Group, materials: CourtyardMaterials): void {
  for (const [index, plant] of WORLD.scene.vegetation.entries()) {
    if (plant.kind === 'tree') {
      createTree(root, index, plant.x, plant.z, plant.height, plant.radius, materials);
    } else {
      createBamboo(root, index, plant.x, plant.z, plant.height, plant.radius, materials);
    }
  }
}

function createMountains(root: Group, seed: number, materials: CourtyardMaterials): void {
  const mountainConfig = WORLD.scene.mountains;
  const mountains = new Group();
  mountains.name = 'distant-mountains';
  const rng = new Rng(seed ^ mountainConfig.seedSalt);
  for (let index = 0; index < mountainConfig.count; index += 1) {
    const angle =
      (index / mountainConfig.count) * Math.PI * 2 +
      rng.range(-mountainConfig.angleJitter, mountainConfig.angleJitter);
    const distance =
      mountainConfig.radius +
      rng.range(-mountainConfig.distanceJitter, mountainConfig.distanceJitter);
    const height = rng.range(mountainConfig.minHeight, mountainConfig.maxHeight);
    const radius = rng.range(
      mountainConfig.baseRadius * mountainConfig.radiusMinScale,
      mountainConfig.baseRadius * mountainConfig.radiusMaxScale,
    );
    const mountain = markMesh(
      new Mesh(new ConeGeometry(radius, height, mountainConfig.segments), materials.mountain),
      `mountain-${index}`,
      false,
    );
    mountain.position.set(
      Math.cos(angle) * distance,
      height / 2 + mountainConfig.baseY,
      Math.sin(angle) * distance,
    );
    mountain.rotation.y = rng.range(0, Math.PI * 2);
    mountains.add(mountain);
  }
  root.add(mountains);
}

/**
 * 创建 M1 首个完整庭院：围墙、铺装、北侧主殿、侧植和远景全部由几何与程序化材质组成。
 * 场景只在启动时创建一次，运行阶段不重建纹理或几何，避免主循环产生额外 GC 压力。
 */
export function createCourtyardWorld(scene: Scene, options: CourtyardWorldOptions): WorldHandle {
  const root = new Group();
  root.name = 'courtyard-world';
  const materials = createCourtyardMaterials(options);

  createGround(root, materials);
  createWalls(root, materials);
  createHall(root, materials);
  createVegetation(root, materials);
  createMountains(root, options.seed, materials);

  scene.add(root);
  return {
    root,
    update(_deltaMs: number): void {
      // M1 保持几何静止，时段与天气变化由 LightingRig / SkyDome 统一处理。
    },
  };
}
