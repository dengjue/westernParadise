import type { QualityTier, TimeOfDayId } from '@/00-types';

/** 世界采用米制建筑尺度。经籍中的无限尺度转译为可辨认、可进入的空间层级。 */
export const PURE_LAND = Object.freeze({
  name: '西方极乐',
  subtitle: '一念清净 · 万象庄严',
  english: 'S U K H Ā V A T Ī',
  eyeHeight: 2.5,
  walkSpeed: 8,
  cameraEase: 2.2,
  fov: 49,
  near: 0.2,
  far: 1800,
  waterY: -0.45,
  bounds: { minX: -88, maxX: 88, minZ: -104, maxZ: 110 },
  hall: { x: 0, z: -51, width: 42, depth: 27, height: 13.8 },
  palette: {
    stone: 0xe6dcc1,
    gold: 0xd6ad57,
    goldDark: 0x8e632a,
    jade: 0x1f6660,
    roof: 0x245c53,
    wood: 0x5b3026,
    leaf: 0xf3e7c7,
    water: 0x2e7774,
  },
  rendering: {
    shadowSpan: 125,
    shadowBias: -0.0002,
    bloomStrength: 0.24,
    bloomRadius: 0.6,
    bloomThreshold: 1.25,
    reflectionSize: { low: 256, medium: 512, high: 768, ultra: 1024 },
    leavesPerTree: { low: 150, medium: 300, high: 580, ultra: 850 },
    lotusCount: { low: 64, medium: 100, high: 150, ultra: 200 },
  },
  views: [
    {
      id: 'overview',
      title: '极乐全境',
      label: '01 / 全境',
      position: [78, 40, 112],
      target: [0, 9, -29],
      description: '宝池映天，楼阁相望。沿着一条金色中轴，走入清净与光明。',
    },
    {
      id: 'lotus',
      title: '七宝莲池',
      label: '02 / 莲池',
      position: [22, 5.8, 52],
      target: [2, 5, -40],
      description: '青、黄、赤、白，四色莲花浮于澄水。低下视线，细看莲瓣与檐影。',
    },
    {
      id: 'hall',
      title: '无量光殿',
      label: '03 / 宝殿',
      position: [0, 7.8, 10],
      target: [0, 13, -51],
      description: '重檐舒展，金柱成林。拾级而上，莲华座与金色造像渐次显现。',
    },
    {
      id: 'grove',
      title: '七重宝树',
      label: '04 / 宝林',
      position: [-58, 9, 24],
      target: [-28, 11, -50],
      description: '行树相当，珠网垂光。宝叶的细微色差，在风与光中交织。',
    },
  ],
  paths: [
    { minX: -7, maxX: 7, minZ: -32, maxZ: 106, height: 1.2 },
    { minX: -85, maxX: 85, minZ: 75, maxZ: 91, height: 1.2 },
    { minX: -85, maxX: 85, minZ: -32, maxZ: -19, height: 1.2 },
    { minX: -69, maxX: -57, minZ: -82, maxZ: 90, height: 1.2 },
    { minX: 57, maxX: 69, minZ: -82, maxZ: 90, height: 1.2 },
    { minX: -64, maxX: 64, minZ: -87, maxZ: -76, height: 1.2 },
    { minX: -28, maxX: 28, minZ: -74, maxZ: -32, height: 3.2 },
    { minX: -9, maxX: 9, minZ: -32, maxZ: -23, height: 3.2 },
  ],
  copy: {
    enter: '步入此境',
    walk: '自由漫游',
    tour: '自动游览',
    pause: '暂停游览',
    sources: '造境手记',
    sourceTitle: '从经典意象，到可游历的世界',
    sourceIntro:
      '以《阿弥陀经》与《观无量寿经》的空间描写为视觉依据，采用传统木构、琉璃与金石语言重新造境。建筑布局与米制尺度为艺术转译。',
    sourceItems: [
      ['七宝池 · 四色莲', '《阿弥陀经》：取宝池、金沙、四边阶道与青黄赤白莲花意象，构成开阔水庭。'],
      [
        '琉璃地 · 黄金界',
        '《观无量寿经》第二、三观：取映彻地面与黄金分界意象，构成青金中轴与白石台地。',
      ],
      [
        '宝树 · 真珠网',
        '《观无量寿经》第四观、《阿弥陀经》：取七重行树、宝叶与珠网意象，形成两侧有序宝林。',
      ],
      [
        '宝楼 · 莲华座',
        '《观无量寿经》第六至八观：取宝楼、莲华座与金色造像意象，建立主殿与远景层次。',
      ],
    ],
    controls: '右键拖动环顾 · 滚轮推近 · WASD 步行 · H 隐藏界面',
    touchControls: '左下移动 · 右下环顾 · 点击景点切换视角',
    note: '经典意象的数字建筑演绎',
  },
} as const);

export const LAND_LIGHT: Readonly<
  Record<
    TimeOfDayId,
    {
      label: string;
      top: number;
      horizon: number;
      fog: number;
      sun: number;
      sunIntensity: number;
      ambient: number;
      exposure: number;
      sunPosition: readonly number[];
    }
  >
> = Object.freeze({
  dawn: {
    label: '晨光',
    top: 0x638c9d,
    horizon: 0xf0cda6,
    fog: 0xc5c8b3,
    sun: 0xffe0ac,
    sunIntensity: 2.8,
    ambient: 1.2,
    exposure: 0.85,
    sunPosition: [-100, 90, -120],
  },
  noon: {
    label: '晴昼',
    top: 0x548eab,
    horizon: 0xdce9df,
    fog: 0xb2c7be,
    sun: 0xfff1d7,
    sunIntensity: 3.2,
    ambient: 1.4,
    exposure: 0.85,
    sunPosition: [-100, 170, 70],
  },
  dusk: {
    label: '落照',
    top: 0x557785,
    horizon: 0xf2bf8e,
    fog: 0xb7b49a,
    sun: 0xffc77a,
    sunIntensity: 3,
    ambient: 1.1,
    exposure: 0.83,
    sunPosition: [-130, 75, -105],
  },
});

export const LAND_QUALITY: Readonly<Record<QualityTier, string>> = Object.freeze({
  low: '流畅',
  medium: '均衡',
  high: '精致',
  ultra: '极致',
});
