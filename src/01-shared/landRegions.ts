import { LAND_CRAFT, LAND_STRUCTURE } from './landCraft';
import { LAND_RENDER } from './landRender';

/** 大世界分区尺寸、门户与灰盒内容的唯一坐标源；坐标均为米制世界 X/Z。 */
const CELL_SIZE = LAND_RENDER.cellSize;
const REGION_SIZE = CELL_SIZE * 5;
const HALF_REGION = REGION_SIZE / 2;
const MIN_WORLD = -REGION_SIZE * 1.5;
const MAX_WORLD = REGION_SIZE * 1.5;
const CORE = { x: 0, z: 0 };
export const LAND_REGION_SURFACE_HEIGHT =
  LAND_STRUCTURE.courtHeight + LAND_CRAFT.floor.courtPavingRise;

export const LAND_WORLD = Object.freeze({
  bounds: { minX: MIN_WORLD, maxX: MAX_WORLD, minZ: MIN_WORLD, maxZ: MAX_WORLD },
  regionSize: REGION_SIZE,
  cellSize: CELL_SIZE,
  /** 北西角为索引原点；每个 240m 区域恰含 5×5 个 cell。 */
  cellOrigin: { x: MIN_WORLD, z: MIN_WORLD },
  regions: [
    {
      id: 'northwest-ridge',
      label: '西北山林',
      seedKey: 'region:northwest-ridge',
      bounds: {
        minX: MIN_WORLD,
        maxX: -HALF_REGION,
        minZ: MIN_WORLD,
        maxZ: -HALF_REGION,
      },
      neighbors: ['north-grove', 'west-garden'],
    },
    {
      id: 'north-grove',
      label: '北侧林径',
      seedKey: 'region:north-grove',
      bounds: {
        minX: -HALF_REGION,
        maxX: HALF_REGION,
        minZ: MIN_WORLD,
        maxZ: -HALF_REGION,
      },
      neighbors: ['northwest-ridge', 'northeast-spring', 'core-court'],
    },
    {
      id: 'northeast-spring',
      label: '东北水源',
      seedKey: 'region:northeast-spring',
      bounds: {
        minX: HALF_REGION,
        maxX: MAX_WORLD,
        minZ: MIN_WORLD,
        maxZ: -HALF_REGION,
      },
      neighbors: ['north-grove', 'east-water-court'],
    },
    {
      id: 'west-garden',
      label: '西侧园林',
      seedKey: 'region:west-garden',
      bounds: {
        minX: MIN_WORLD,
        maxX: -HALF_REGION,
        minZ: -HALF_REGION,
        maxZ: HALF_REGION,
      },
      neighbors: ['northwest-ridge', 'core-court', 'southwest-garden'],
    },
    {
      id: 'core-court',
      label: '中轴庭院',
      seedKey: 'region:core-court',
      bounds: {
        minX: -HALF_REGION,
        maxX: HALF_REGION,
        minZ: -HALF_REGION,
        maxZ: HALF_REGION,
      },
      neighbors: ['north-grove', 'west-garden', 'east-water-court', 'south-forecourt'],
    },
    {
      id: 'east-water-court',
      label: '东侧水院',
      seedKey: 'region:east-water-court',
      bounds: {
        minX: HALF_REGION,
        maxX: MAX_WORLD,
        minZ: -HALF_REGION,
        maxZ: HALF_REGION,
      },
      neighbors: ['northeast-spring', 'core-court', 'southeast-garden'],
    },
    {
      id: 'southwest-garden',
      label: '西南回游园',
      seedKey: 'region:southwest-garden',
      bounds: {
        minX: MIN_WORLD,
        maxX: -HALF_REGION,
        minZ: HALF_REGION,
        maxZ: MAX_WORLD,
      },
      neighbors: ['west-garden', 'south-forecourt'],
    },
    {
      id: 'south-forecourt',
      label: '南侧前庭',
      seedKey: 'region:south-forecourt',
      bounds: {
        minX: -HALF_REGION,
        maxX: HALF_REGION,
        minZ: HALF_REGION,
        maxZ: MAX_WORLD,
      },
      neighbors: ['core-court', 'southwest-garden', 'southeast-garden'],
    },
    {
      id: 'southeast-garden',
      label: '东南园林',
      seedKey: 'region:southeast-garden',
      bounds: {
        minX: HALF_REGION,
        maxX: MAX_WORLD,
        minZ: HALF_REGION,
        maxZ: MAX_WORLD,
      },
      neighbors: ['east-water-court', 'south-forecourt'],
    },
  ],
  /** 相邻区共用同一门户坐标；中心区东门对齐既有南侧横向游线。 */
  portals: [
    { from: 'northwest-ridge', to: 'north-grove', x: -HALF_REGION, z: -REGION_SIZE },
    { from: 'north-grove', to: 'northeast-spring', x: HALF_REGION, z: -REGION_SIZE },
    { from: 'west-garden', to: 'core-court', x: -HALF_REGION, z: CORE.z },
    { from: 'core-court', to: 'east-water-court', x: HALF_REGION, z: 83 },
    { from: 'southwest-garden', to: 'south-forecourt', x: -HALF_REGION, z: REGION_SIZE },
    { from: 'south-forecourt', to: 'southeast-garden', x: HALF_REGION, z: REGION_SIZE },
    { from: 'northwest-ridge', to: 'west-garden', x: -REGION_SIZE, z: -HALF_REGION },
    { from: 'west-garden', to: 'southwest-garden', x: -REGION_SIZE, z: HALF_REGION },
    { from: 'north-grove', to: 'core-court', x: CORE.x, z: -HALF_REGION },
    { from: 'core-court', to: 'south-forecourt', x: CORE.x, z: HALF_REGION },
    { from: 'northeast-spring', to: 'east-water-court', x: REGION_SIZE, z: -HALF_REGION },
    { from: 'east-water-court', to: 'southeast-garden', x: REGION_SIZE, z: HALF_REGION },
  ],
  prototype: {
    /** 只给 ?cam=third 使用；其余七区未生成，边界也不开放到空白区域。 */
    bounds: {
      minX: -88,
      maxX: MAX_WORLD,
      minZ: -HALF_REGION,
      maxZ: HALF_REGION,
    },
    enabledRegions: ['core-court', 'east-water-court'],
    east: {
      groundHeight: LAND_REGION_SURFACE_HEIGHT,
      groundThickness: 1.8,
      route: {
        minX: 80,
        maxX: MAX_WORLD,
        minZ: 75,
        maxZ: 91,
        height: LAND_STRUCTURE.courtHeight,
      },
      pond: {
        x: 252,
        z: 16,
        radius: 30,
        /** 横跨莲池南北向的简化步桥；端点落在可走岸面。 */
        bridge: {
          centerX: 252,
          minZ: -23,
          maxZ: 55,
          width: 8,
          rise: 0.28,
          railHeight: 0.85,
        },
      },
      /** 接通步桥北端与主路南缘；高度沿用陆地铺装，不改变行走采样。 */
      bridgeApproach: {
        width: 8,
      },
      /** 东区路侧的小尺度双树花台，位置避开主路、支路和 24m/48m cell 接缝。 */
      roadsidePlanting: {
        beds: [
          { x: 132, z: 60 },
          { x: 180, z: 108 },
          { x: 228, z: 60 },
          { x: 276, z: 108 },
          { x: 324, z: 60 },
        ],
        bedWidth: 10,
        bedDepth: 7.2,
        bedHeight: 0.32,
        soilInset: 0.45,
        soilThickness: 0.14,
        treeSpacing: 4.8,
        trunkRadius: 0.22,
        trunkHeight: 2.6,
        canopy: {
          lowerOffset: 0.55,
          lowerSize: [3.4, 2.4, 3.4],
          upperOffset: 1.45,
          upperSize: [2.3, 2.1, 2.3],
        },
      },
      landmark: {
        x: 314,
        z: 40,
        label: '水院观景台',
        pillarHeight: 5.2,
        pillarSize: LAND_CRAFT.column.footHeight * 2,
        roofHeight: 0.8,
        span: 8,
      },
      boundary: {
        height: 2.4,
        thickness: 1.2,
      },
    },
  },
} as const);
