import { CanvasTexture, SRGBColorSpace } from 'three';
import { LAND_CRAFT } from '@/01-shared';
import type { CanvasFactory } from './courtyard';

function* lotusSteps(
  ctx: CanvasRenderingContext2D,
  palette: typeof LAND_CRAFT.material.ornament,
  x: number,
  y: number,
  radius: number,
  onStage?: (stage: string) => void,
): Generator<void, void, void> {
  ctx.save();
  ctx.translate(x, y);
  for (let petal = 0; petal < 8; petal++) {
    onStage?.(`ornament-lotus:${petal}`);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-radius * 0.4, radius * 0.3, -radius * 0.2, radius * 0.72, 0, radius);
    ctx.bezierCurveTo(radius * 0.2, radius * 0.72, radius * 0.4, radius * 0.3, 0, 6);
    ctx.stroke();
    yield;
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = palette.ink;
  ctx.fill();
  ctx.restore();
}

/** 瓦当莲瓣与梁枋卷草共用小幅贴图；装饰不再用密集独立球体表达。 */
export function* ornamentTextureSteps(
  factory: CanvasFactory,
  kind: 'tile' | 'frieze',
  onStage?: (stage: string) => void,
): Generator<void, CanvasTexture, void> {
  const width = kind === 'tile' ? 256 : 1024,
    height = 256;
  const canvas = factory(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建建筑纹饰');
  const palette = LAND_CRAFT.material.ornament;
  onStage?.(`${kind}:ground`);
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = palette.ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  if (kind === 'tile') {
    for (const radius of [100, 116]) {
      onStage?.(`${kind}:rings`);
      ctx.beginPath();
      ctx.arc(128, 128, radius, 0, Math.PI * 2);
      ctx.stroke();
      yield;
    }
    yield* lotusSteps(ctx, palette, 128, 128, 86, onStage);
  } else {
    onStage?.(`${kind}:border`);
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 12, width - 20, height - 24);
    yield;
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 24, width - 36, height - 48);
    yield;
    yield* lotusSteps(ctx, palette, width / 2, height / 2, 74, onStage);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(side, 1);
      for (const vertical of [-1, 1]) {
        onStage?.(`${kind}:frieze-curve`);
        ctx.beginPath();
        ctx.moveTo(90, 0);
        ctx.bezierCurveTo(160, vertical * 90, 235, vertical * 90, 275, 0);
        ctx.bezierCurveTo(320, -vertical * 80, 380, -vertical * 70, 425, 0);
        ctx.bezierCurveTo(456, vertical * 50, 395, vertical * 70, 391, vertical * 26);
        ctx.stroke();
        yield;
      }
      ctx.restore();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function ornamentTexture(factory: CanvasFactory, kind: 'tile' | 'frieze'): CanvasTexture {
  const steps = ornamentTextureSteps(factory, kind);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
