import { CanvasTexture, SRGBColorSpace } from 'three';
import { LAND_CRAFT } from '@/01-shared';
import type { CanvasFactory } from './courtyard';

/** 瓦当莲瓣与梁枋卷草共用小幅贴图；装饰不再用密集独立球体表达。 */
export function ornamentTexture(factory: CanvasFactory, kind: 'tile' | 'frieze'): CanvasTexture {
  const width = kind === 'tile' ? 256 : 1024,
    height = 256;
  const canvas = factory(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建建筑纹饰');
  const palette = LAND_CRAFT.material.ornament;
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = palette.ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  const lotus = (x: number, y: number, radius: number): void => {
    ctx.save();
    ctx.translate(x, y);
    for (let petal = 0; petal < 8; petal++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.bezierCurveTo(-radius * 0.4, radius * 0.3, -radius * 0.2, radius * 0.72, 0, radius);
      ctx.bezierCurveTo(radius * 0.2, radius * 0.72, radius * 0.4, radius * 0.3, 0, 6);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = palette.ink;
    ctx.fill();
    ctx.restore();
  };
  if (kind === 'tile') {
    for (const radius of [100, 116]) {
      ctx.beginPath();
      ctx.arc(128, 128, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    lotus(128, 128, 86);
  } else {
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 12, width - 20, height - 24);
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 24, width - 36, height - 48);
    lotus(width / 2, height / 2, 74);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(side, 1);
      for (const vertical of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(90, 0);
        ctx.bezierCurveTo(160, vertical * 90, 235, vertical * 90, 275, 0);
        ctx.bezierCurveTo(320, -vertical * 80, 380, -vertical * 70, 425, 0);
        ctx.bezierCurveTo(456, vertical * 50, 395, vertical * 70, 391, vertical * 26);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
