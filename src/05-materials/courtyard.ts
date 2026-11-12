import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';
import { MATERIALS } from '@/01-shared';
import { valueNoise } from './noise';

/**
 * 由装配层注入的画布创建器。
 *
 * 05-materials 不直接读取 document，避免把浏览器 API 扩散到材质层；99-boot 在浏览器
 * 边界内提供实现，材质工厂只接收一个可绘制的 Canvas 来源。
 */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

export interface CourtyardMaterialsOptions {
  readonly canvasFactory: CanvasFactory;
  readonly seed: number;
  readonly anisotropy: number;
}

export interface CourtyardMaterials {
  readonly ground: MeshStandardMaterial;
  readonly platform: MeshStandardMaterial;
  readonly wall: MeshStandardMaterial;
  readonly plaster: MeshStandardMaterial;
  readonly wood: MeshStandardMaterial;
  readonly tile: MeshStandardMaterial;
  readonly paving: MeshStandardMaterial;
  readonly leaf: MeshStandardMaterial;
  readonly mountain: MeshStandardMaterial;
  readonly figureBody: MeshStandardMaterial;
  readonly figureHead: MeshStandardMaterial;
  readonly figureAccent: MeshStandardMaterial;
  readonly figurePedestal: MeshStandardMaterial;
}

interface Palette {
  readonly baseHex: number;
  readonly darkHex: number;
  readonly lightHex: number;
}

interface CanvasAndContext {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

function channel(hex: number, shift: number): number {
  return (hex >> shift) & 0xff;
}

function rgb(hex: number): readonly [number, number, number] {
  return [channel(hex, 16), channel(hex, 8), channel(hex, 0)];
}

function colorString(hex: number, alpha = 1): string {
  const [red, green, blue] = rgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function mixChannel(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function noiseColor(value: number, palette: Palette): string {
  const normalized = value / 255;
  const [darkRed, darkGreen, darkBlue] = rgb(palette.darkHex);
  const [baseRed, baseGreen, baseBlue] = rgb(palette.baseHex);
  const [lightRed, lightGreen, lightBlue] = rgb(palette.lightHex);
  if (normalized < 0.5) {
    const amount = normalized * 2;
    return `rgb(${mixChannel(darkRed, baseRed, amount)}, ${mixChannel(darkGreen, baseGreen, amount)}, ${mixChannel(darkBlue, baseBlue, amount)})`;
  }
  const amount = (normalized - 0.5) * 2;
  return `rgb(${mixChannel(baseRed, lightRed, amount)}, ${mixChannel(baseGreen, lightGreen, amount)}, ${mixChannel(baseBlue, lightBlue, amount)})`;
}

function createCanvas(factory: CanvasFactory, width: number, height: number): CanvasAndContext {
  const canvas = factory(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('无法创建程序化材质画布');
  }
  return { canvas, context };
}

function drawNoiseField(context: CanvasRenderingContext2D, palette: Palette, seed: number): void {
  const { width, height, cellsX, cellsY } = MATERIALS.texture;
  const noise = valueNoise({ width, height, seed, cellsX, cellsY });
  const image = context.createImageData(width, height);
  for (let index = 0; index < noise.length; index += 1) {
    const value = noise[index] ?? 0;
    const [red, green, blue] = rgbFromCss(noiseColor(value, palette));
    const offset = index * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

/** 纹理颜色只在本地生成，解析三通道后直接写入 ImageData，避免逐像素 draw 调用。 */
function rgbFromCss(value: string): readonly [number, number, number] {
  const match = value.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (match === null) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function createCanvasTexture(
  factory: CanvasFactory,
  palette: Palette,
  seed: number,
  overlay: (context: CanvasRenderingContext2D) => void,
  anisotropy: number,
): CanvasTexture {
  const { width, height } = MATERIALS.texture;
  const { canvas, context } = createCanvas(factory, width, height);
  drawNoiseField(context, palette, seed);
  overlay(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function drawStoneOverlay(context: CanvasRenderingContext2D): void {
  const palette = MATERIALS.stone;
  context.save();
  context.globalAlpha = 0.32;
  context.strokeStyle = colorString(palette.darkHex);
  context.lineWidth = 1;
  for (let y = 12; y < MATERIALS.texture.height; y += 24) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(MATERIALS.texture.width, y + 0.5);
    context.stroke();
  }
  context.restore();
}

function drawPavingOverlay(context: CanvasRenderingContext2D): void {
  const palette = MATERIALS.paving;
  const cellWidth = MATERIALS.texture.width / MATERIALS.texture.cellsX;
  const cellHeight = MATERIALS.texture.height / MATERIALS.texture.cellsY;
  context.save();
  context.globalAlpha = 0.62;
  context.strokeStyle = colorString(palette.darkHex);
  context.lineWidth = 1.5;
  for (let row = 0; row <= MATERIALS.texture.cellsY; row += 1) {
    const y = row * cellHeight + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(MATERIALS.texture.width, y);
    context.stroke();
  }
  for (let column = 0; column <= MATERIALS.texture.cellsX; column += 1) {
    const x = column * cellWidth + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, MATERIALS.texture.height);
    context.stroke();
  }
  context.restore();
}

function drawWoodOverlay(context: CanvasRenderingContext2D): void {
  const palette = MATERIALS.wood;
  context.save();
  context.globalAlpha = 0.45;
  context.strokeStyle = colorString(palette.darkHex);
  context.lineWidth = 1;
  for (let y = 8; y < MATERIALS.texture.height; y += 16) {
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(24, y - 3, 64, y + 3, MATERIALS.texture.width, y);
    context.stroke();
  }
  context.restore();
}

function drawTileOverlay(context: CanvasRenderingContext2D): void {
  const palette = MATERIALS.tile;
  const cellWidth = MATERIALS.texture.width / 6;
  const cellHeight = MATERIALS.texture.height / 8;
  context.save();
  context.globalAlpha = 0.58;
  context.strokeStyle = colorString(palette.darkHex);
  context.lineWidth = 2;
  for (let row = 0; row <= 8; row += 1) {
    const y = row * cellHeight;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(MATERIALS.texture.width, y);
    context.stroke();
  }
  for (let row = 0; row < 8; row += 1) {
    const offset = row % 2 === 0 ? 0 : cellWidth / 2;
    for (let column = -1; column <= 6; column += 1) {
      const x = column * cellWidth + offset;
      context.beginPath();
      context.moveTo(x, row * cellHeight);
      context.lineTo(x, (row + 1) * cellHeight);
      context.stroke();
    }
  }
  context.restore();
}

function texturedMaterial(
  texture: CanvasTexture,
  roughness: number,
  metalness: number,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: texture,
    roughness,
    metalness,
  });
}

function solidMaterial(
  colorHex: number,
  roughness: number,
  metalness: number,
): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: colorHex, roughness, metalness });
}

/**
 * 生成庭院使用的全部材质。
 *
 * 每张纹理在启动时由固定 seed 生成，既保留手工绘制的砖缝/木纹结构，又让同一 seed
 * 能复现细部噪声。工厂不持有全局缓存，释放仍由 SceneContext 统一处理。
 */
export function createCourtyardMaterials(options: CourtyardMaterialsOptions): CourtyardMaterials {
  const stoneTexture = createCanvasTexture(
    options.canvasFactory,
    MATERIALS.stone,
    options.seed + 11,
    drawStoneOverlay,
    options.anisotropy,
  );
  const platformTexture = createCanvasTexture(
    options.canvasFactory,
    MATERIALS.stone,
    options.seed + 13,
    drawStoneOverlay,
    options.anisotropy,
  );
  const pavingTexture = createCanvasTexture(
    options.canvasFactory,
    MATERIALS.paving,
    options.seed + 17,
    drawPavingOverlay,
    options.anisotropy,
  );
  const woodTexture = createCanvasTexture(
    options.canvasFactory,
    MATERIALS.wood,
    options.seed + 19,
    drawWoodOverlay,
    options.anisotropy,
  );
  const tileTexture = createCanvasTexture(
    options.canvasFactory,
    MATERIALS.tile,
    options.seed + 23,
    drawTileOverlay,
    options.anisotropy,
  );
  const plasterTexture = createCanvasTexture(
    options.canvasFactory,
    MATERIALS.plaster,
    options.seed + 29,
    (context) => {
      context.save();
      context.globalAlpha = 0.18;
      context.strokeStyle = colorString(MATERIALS.plaster.darkHex);
      context.lineWidth = 1;
      for (let y = 10; y < MATERIALS.texture.height; y += 18) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(MATERIALS.texture.width, y + 3);
        context.stroke();
      }
      context.restore();
    },
    options.anisotropy,
  );

  return {
    ground: texturedMaterial(stoneTexture, MATERIALS.stone.roughness, MATERIALS.stone.metalness),
    platform: texturedMaterial(
      platformTexture,
      MATERIALS.stone.roughness,
      MATERIALS.stone.metalness,
    ),
    wall: solidMaterial(
      MATERIALS.stone.baseHex,
      MATERIALS.stone.roughness,
      MATERIALS.stone.metalness,
    ),
    plaster: texturedMaterial(
      plasterTexture,
      MATERIALS.plaster.roughness,
      MATERIALS.plaster.metalness,
    ),
    wood: texturedMaterial(woodTexture, MATERIALS.wood.roughness, MATERIALS.wood.metalness),
    tile: texturedMaterial(tileTexture, MATERIALS.tile.roughness, MATERIALS.tile.metalness),
    paving: texturedMaterial(pavingTexture, MATERIALS.paving.roughness, MATERIALS.paving.metalness),
    leaf: solidMaterial(MATERIALS.leaf.baseHex, MATERIALS.leaf.roughness, MATERIALS.leaf.metalness),
    mountain: solidMaterial(
      MATERIALS.mountain.baseHex,
      MATERIALS.mountain.roughness,
      MATERIALS.mountain.metalness,
    ),
    figureBody: solidMaterial(
      MATERIALS.figure.bodyHex,
      MATERIALS.figure.roughness,
      MATERIALS.figure.metalness,
    ),
    figureHead: solidMaterial(
      MATERIALS.figure.headHex,
      MATERIALS.figure.roughness,
      MATERIALS.figure.metalness,
    ),
    figureAccent: solidMaterial(
      MATERIALS.figure.accentHex,
      MATERIALS.figure.roughness,
      MATERIALS.figure.metalness,
    ),
    figurePedestal: solidMaterial(
      MATERIALS.figure.pedestalHex,
      MATERIALS.figure.roughness,
      MATERIALS.figure.metalness,
    ),
  };
}
