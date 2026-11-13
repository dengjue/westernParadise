import { CanvasTexture, SRGBColorSpace } from 'three';
import { LAND_GARDEN } from '@/01-shared';
import type { CanvasFactory } from './courtyard';

/** 荷叶纹理是正交平面投影；主脉与分叉细脉从叶心放射，避免把树叶直脉贴到圆叶。 */
export function createLilyTexture(factory: CanvasFactory): CanvasTexture {
  const size = 384,
    center = size / 2,
    radius = center * 0.94;
  const canvas = factory(size, size),
    ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建莲叶纹理');
  const gradient = ctx.createRadialGradient(center, center, 5, center, center, radius);
  gradient.addColorStop(0, '#a4b8a0');
  gradient.addColorStop(0.16, '#e4e7ce');
  gradient.addColorStop(0.76, '#b5c6a7');
  gradient.addColorStop(1, '#dce0b6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#eef0cc';
  ctx.lineCap = 'round';
  for (let vein = 0; vein < LAND_GARDEN.lily.veins; vein++) {
    const angle = (vein / LAND_GARDEN.lily.veins) * Math.PI * 2;
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(8, -radius * 0.6, 0, -radius);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 0.85;
    for (let level = 1; level < 6; level++)
      for (const side of [-1, 1]) {
        const y = (-radius * level) / 6;
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.bezierCurveTo(side * 12, y - 12, side * 22, y - 14, side * 28, y - 30);
        ctx.stroke();
      }
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
