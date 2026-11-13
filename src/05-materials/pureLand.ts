import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { PURE_LAND } from '@/01-shared';
import { Rng } from '@/02-core';
import type { CanvasFactory } from './courtyard';

/** 可重复贴图在创建时生成；细节由颜色与凹凸共同承担，避免远看像单色塑料。 */
function surfaceTexture(
  factory: CanvasFactory,
  seed: number,
  kind: 'stone' | 'gold' | 'wood' | 'roof',
): CanvasTexture {
  const size = 512;
  const canvas = factory(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建材质画布');
  const rng = new Rng(seed);
  ctx.fillStyle = kind === 'wood' ? '#b3a99a' : '#e1ded3';
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const variation = rng.range(-13, 13);
    for (let c = 0; c < 3; c++) image.data[i + c] = (image.data[i + c] ?? 220) + variation;
  }
  ctx.putImageData(image, 0, 0);
  if (kind === 'stone') {
    ctx.strokeStyle = '#9b9889';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.strokeStyle = '#c6c2b5';
    for (let i = 0; i < 24; i++) {
      ctx.beginPath();
      const x = rng.range(0, size);
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 85, 160, x - 40, 330, x + 100, 512);
      ctx.lineWidth = rng.range(0.3, 1.4);
      ctx.stroke();
    }
  } else if (kind === 'roof') {
    for (let x = 0; x < size; x += 32) {
      const gradient = ctx.createLinearGradient(x, 0, x + 32, 0);
      gradient.addColorStop(0, '#60665c');
      gradient.addColorStop(0.36, '#efede0');
      gradient.addColorStop(0.7, '#b9bbab');
      gradient.addColorStop(1, '#60665c');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, 32, size);
    }
    ctx.strokeStyle = '#7a8070';
    ctx.lineWidth = 2;
    for (let y = 0; y < size; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = kind === 'gold' ? 0.07 : 0.23;
    ctx.strokeStyle = '#322b20';
    for (let y = 0; y < size; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(160, y + rng.range(-7, 7), 340, y - 4, size, y);
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 叶脉与莲瓣丝纹使用共享灰度纹理，再与每个实例的宝石色相乘。 */
function botanicalTexture(factory: CanvasFactory, leaf: boolean): CanvasTexture {
  const canvas = factory(256, 384);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建植物纹理');
  const gradient = ctx.createLinearGradient(0, 384, 0, 0);
  gradient.addColorStop(0, leaf ? '#7f8b68' : '#fff8ef');
  gradient.addColorStop(0.46, leaf ? '#e5e6c7' : '#e9dbe0');
  gradient.addColorStop(1, leaf ? '#a9ba91' : '#b8a5ae');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 384);
  ctx.lineCap = 'round';
  if (leaf) {
    ctx.strokeStyle = '#f2eed5';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(128, 384);
    ctx.lineTo(128, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let y = 45; y < 370; y += 28)
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(128, y + 24);
        ctx.bezierCurveTo(128 + side * 30, y + 7, 128 + side * 75, y - 5, 128 + side * 115, y - 45);
        ctx.stroke();
      }
  } else {
    ctx.strokeStyle = '#fff9ed';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 0.8;
    for (let x = 0; x <= 256; x += 9) {
      ctx.beginPath();
      ctx.moveTo(128, 384);
      ctx.bezierCurveTo(x, 240, x, 100, x, 0);
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createPureLandMaterials(factory: CanvasFactory, seed: number, anisotropy: number) {
  const { palette } = PURE_LAND;
  const stone = surfaceTexture(factory, seed, 'stone');
  const gold = surfaceTexture(factory, seed + 1, 'gold');
  const wood = surfaceTexture(factory, seed + 2, 'wood');
  const roof = surfaceTexture(factory, seed + 3, 'roof');
  const leaf = botanicalTexture(factory, true);
  const petal = botanicalTexture(factory, false);
  for (const texture of [stone, gold, wood, roof, leaf, petal]) texture.anisotropy = anisotropy;
  roof.repeat.set(3, 2);
  const stoneMaterial = new MeshStandardMaterial({
    color: palette.stone,
    map: stone,
    bumpMap: stone,
    bumpScale: 0.025,
    roughness: 0.76,
    metalness: 0.03,
  });
  // 按世界坐标投射石砖，巨大台基与一米柱础保持同样的砖缝尺度。
  stoneMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vStoneWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvStoneWorld = (modelMatrix * vec4(position,1.0)).xyz;',
    );
    shader.fragmentShader = 'varying vec3 vStoneWorld;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      vec3 axis = abs(normalize(cross(dFdx(vStoneWorld), dFdy(vStoneWorld))));
      vec2 surfaceUv = axis.y > 0.6 ? vStoneWorld.xz * 0.42 : vec2(vStoneWorld.x + vStoneWorld.z, vStoneWorld.y * 2.0) * 0.42;
      diffuseColor *= texture2D(map, surfaceUv);
      vec2 tilePosition = fract(surfaceUv);
      float jointDistance = min(min(tilePosition.x, 1.0-tilePosition.x), min(tilePosition.y, 1.0-tilePosition.y));
      diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.003, 0.012, jointDistance));
    `,
    );
  };
  return {
    stone: stoneMaterial,
    gold: new MeshStandardMaterial({
      color: palette.gold,
      map: gold,
      roughness: 0.28,
      metalness: 0.78,
    }),
    goldDark: new MeshStandardMaterial({
      color: palette.goldDark,
      map: gold,
      roughness: 0.39,
      metalness: 0.65,
    }),
    sculpture: new MeshStandardMaterial({
      color: 0xc6a35d,
      map: gold,
      metalness: 0.83,
      roughness: 0.44,
    }),
    sculptureFold: new MeshStandardMaterial({ color: 0xb99750, metalness: 0.75, roughness: 0.5 }),
    jade: new MeshStandardMaterial({
      color: palette.jade,
      map: stone,
      roughness: 0.24,
      metalness: 0.38,
    }),
    roof: new MeshStandardMaterial({
      color: palette.roof,
      map: roof,
      bumpMap: roof,
      bumpScale: 0.18,
      roughness: 0.62,
      metalness: 0.26,
      side: 2,
    }),
    wood: new MeshStandardMaterial({
      color: palette.wood,
      map: wood,
      roughness: 0.48,
      metalness: 0.16,
    }),
    dark: new MeshStandardMaterial({ color: 0x173b35, roughness: 0.6, metalness: 0.15 }),
    pearl: new MeshStandardMaterial({
      color: 0xffeed0,
      roughness: 0.22,
      metalness: 0.2,
      emissive: 0xe8b970,
      emissiveIntensity: 0.12,
    }),
    glow: new MeshBasicMaterial({ color: new Color(2.1, 1.4, 0.6) }),
    leaf: new MeshStandardMaterial({
      color: palette.leaf,
      map: leaf,
      bumpMap: leaf,
      bumpScale: 0.045,
      roughness: 0.48,
      metalness: 0.32,
      side: 2,
    }),
    lotus: [0xd17d96, 0xf7e8d5, 0x70b5cc, 0xe2bf66].map(
      (color) =>
        new MeshStandardMaterial({
          color,
          map: petal,
          bumpMap: petal,
          bumpScale: 0.016,
          roughness: 0.5,
          metalness: 0.06,
          side: 2,
          emissive: color,
          emissiveIntensity: 0.04,
        }),
    ),
    lily: new MeshStandardMaterial({ color: 0x458678, roughness: 0.48, metalness: 0.15, side: 2 }),
  };
}

export type PureLandMaterials = ReturnType<typeof createPureLandMaterials>;

export function createHallPlaque(factory: CanvasFactory): MeshStandardMaterial {
  const canvas = factory(1024, 256);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建匾额');
  ctx.fillStyle = '#163a32';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#d1aa60';
  ctx.lineWidth = 7;
  ctx.strokeRect(18, 18, 988, 220);
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, 964, 196);
  ctx.font = '140px "Songti SC", "STSong", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f1d698';
  ctx.fillText(PURE_LAND.views[2].title, 512, 134);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return new MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.2 });
}
