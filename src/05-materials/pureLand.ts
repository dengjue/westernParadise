import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';
import type { Material } from 'three';
import { LAND_CRAFT, LAND_GARDEN, PURE_LAND } from '@/01-shared';
import { Rng } from '@/02-core';
import type { CanvasFactory } from './courtyard';
import { ornamentTextureSteps } from './landOrnament';
import { projectedStone } from './landStone';
import { createLilyTextureSteps } from './landLily';

type MaterialOwner = <T extends Material>(material: T) => T;
type BuildStage = (stage: string) => void;

function consume<T>(steps: Generator<void, T, void>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** 可重复贴图的像素扰动分批执行；同步 API 仍消费相同序列。 */
function* surfaceTextureSteps(
  factory: CanvasFactory,
  seed: number,
  kind: 'stone' | 'carvedStone' | 'gold' | 'wood' | 'roof',
  onStage?: BuildStage,
): Generator<void, CanvasTexture, void> {
  const size = 512;
  const canvas = factory(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建材质画布');
  const rng = new Rng(seed);
  ctx.fillStyle = kind === 'wood' ? '#b3a99a' : '#e1ded3';
  ctx.fillRect(0, 0, size, size);
  onStage?.(`${kind}:pixels`);
  const rowsPerChunk = 8;
  for (let y = 0; y < size; y += rowsPerChunk) {
    const height = Math.min(rowsPerChunk, size - y);
    const image = ctx.getImageData(0, y, size, height);
    for (let i = 0; i < image.data.length; i += 4) {
      const variation = rng.range(-13, 13);
      for (let channel = 0; channel < 3; channel++)
        image.data[i + channel] = (image.data[i + channel] ?? 220) + variation;
    }
    ctx.putImageData(image, 0, y);
    yield;
  }

  if (kind === 'stone' || kind === 'carvedStone') {
    onStage?.(`${kind}:veins`);
    if (kind === 'stone') {
      ctx.strokeStyle = '#9b9889';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      yield;
    }
    ctx.strokeStyle = '#c6c2b5';
    for (let i = 0; i < 24; i++) {
      const x = rng.range(0, size);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 85, 160, x - 40, 330, x + 100, 512);
      ctx.lineWidth = rng.range(0.3, 1.4);
      ctx.stroke();
      yield;
    }
  } else if (kind === 'roof') {
    onStage?.('roof:tiles');
    for (let x = 0; x < size; x += 32) {
      const gradient = ctx.createLinearGradient(x, 0, x + 32, 0);
      gradient.addColorStop(0, '#60665c');
      gradient.addColorStop(0.36, '#efede0');
      gradient.addColorStop(0.7, '#b9bbab');
      gradient.addColorStop(1, '#60665c');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, 32, size);
      yield;
    }
    ctx.strokeStyle = '#7a8070';
    ctx.lineWidth = 2;
    onStage?.('roof:seams');
    for (let y = 0; y < size; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
      yield;
    }
  } else {
    onStage?.(`${kind}:grain`);
    ctx.globalAlpha = kind === 'gold' ? 0.07 : 0.23;
    ctx.strokeStyle = '#322b20';
    for (let y = 0; y < size; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(160, y + rng.range(-7, 7), 340, y - 4, size, y);
      ctx.stroke();
      if (y % 24 === 21) yield;
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 叶脉与莲瓣丝纹使用共享灰度纹理，再与每个实例的宝石色相乘。 */
function* botanicalTextureSteps(
  factory: CanvasFactory,
  leaf: boolean,
  onStage?: BuildStage,
): Generator<void, CanvasTexture, void> {
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
    onStage?.('leaf-veins');
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
        yield;
      }
  } else {
    onStage?.('petal-veins');
    ctx.strokeStyle = '#fff9ed';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 0.8;
    for (let x = 0; x <= 256; x += 9) {
      ctx.beginPath();
      ctx.moveTo(128, 384);
      ctx.bezierCurveTo(x, 240, x, 100, x, 0);
      ctx.stroke();
      yield;
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createPureLandMaterialSet(
  stone: CanvasTexture,
  carvedStone: CanvasTexture,
  gold: CanvasTexture,
  wood: CanvasTexture,
  roof: CanvasTexture,
  leaf: CanvasTexture,
  petal: CanvasTexture,
  lily: CanvasTexture,
  tileEnd: CanvasTexture,
  frieze: CanvasTexture,
  anisotropy: number,
  ownTexture: <T extends Texture>(texture: T) => T,
  ownMaterial: MaterialOwner,
) {
  const { palette } = PURE_LAND;
  const craft = LAND_CRAFT.material;
  for (const texture of [stone, carvedStone, gold, wood, roof, leaf, petal, lily, tileEnd, frieze])
    texture.anisotropy = anisotropy;
  const leafBump = ownTexture(leaf.clone()),
    petalBump = ownTexture(petal.clone()),
    lilyBump = ownTexture(lily.clone());
  for (const texture of [leafBump, petalBump, lilyBump]) texture.colorSpace = NoColorSpace;
  const botany = LAND_GARDEN.material;
  roof.repeat.set(3, 2);
  return {
    stone: ownMaterial(projectedStone(stone, palette.stone, craft.stone)),
    carvedStone: ownMaterial(projectedStone(carvedStone, palette.stone, craft.carvedStone)),
    tileEnd: ownMaterial(
      new MeshStandardMaterial({
        map: tileEnd,
        roughness: craft.roof.roughness,
        metalness: craft.roof.metalness,
      }),
    ),
    frieze: ownMaterial(
      new MeshStandardMaterial({
        map: frieze,
        roughness: craft.wood.roughness,
        metalness: craft.wood.metalness,
      }),
    ),
    gold: ownMaterial(
      new MeshStandardMaterial({
        color: palette.gold,
        map: gold,
        ...craft.gold,
      }),
    ),
    goldDark: ownMaterial(
      new MeshStandardMaterial({
        color: palette.goldDark,
        map: gold,
        ...craft.goldDark,
      }),
    ),
    sculpture: ownMaterial(
      new MeshStandardMaterial({
        map: gold,
        ...craft.sculpture,
      }),
    ),
    sculptureFold: ownMaterial(new MeshStandardMaterial(craft.fold)),
    jade: ownMaterial(
      new MeshStandardMaterial({
        color: palette.jade,
        map: carvedStone,
        ...craft.jade,
      }),
    ),
    roof: ownMaterial(
      new MeshStandardMaterial({
        color: palette.roof,
        map: roof,
        bumpMap: roof,
        bumpScale: craft.roof.bump,
        roughness: craft.roof.roughness,
        metalness: craft.roof.metalness,
        side: 2,
      }),
    ),
    wood: ownMaterial(
      new MeshStandardMaterial({
        color: palette.wood,
        map: wood,
        ...craft.wood,
      }),
    ),
    dark: ownMaterial(
      new MeshStandardMaterial({ color: 0x173b35, roughness: 0.6, metalness: 0.15 }),
    ),
    pearl: ownMaterial(
      new MeshStandardMaterial({
        color: 0xffeed0,
        roughness: 0.22,
        metalness: 0.2,
        emissive: 0xe8b970,
        emissiveIntensity: 0.12,
      }),
    ),
    glow: ownMaterial(new MeshBasicMaterial({ color: new Color(2.1, 1.4, 0.6) })),
    leaf: ownMaterial(
      new MeshStandardMaterial({
        color: palette.leaf,
        map: leaf,
        bumpMap: leafBump,
        bumpScale: botany.leaf.bump,
        roughness: botany.leaf.roughness,
        metalness: botany.leaf.metalness,
        side: 2,
      }),
    ),
    lotus: LAND_GARDEN.lotus.colors.map((color) =>
      ownMaterial(
        new MeshStandardMaterial({
          color,
          map: petal,
          bumpMap: petalBump,
          bumpScale: botany.petal.bump,
          roughness: botany.petal.roughness,
          metalness: botany.petal.metalness,
          side: 2,
          emissive: color,
          emissiveIntensity: 0.04,
        }),
      ),
    ),
    lily: ownMaterial(
      new MeshStandardMaterial({
        color: botany.lily.color,
        map: lily,
        bumpMap: lilyBump,
        bumpScale: botany.lily.bump,
        roughness: botany.lily.roughness,
        metalness: botany.lily.metalness,
        side: 2,
      }),
    ),
  };
}

export type PureLandMaterials = ReturnType<typeof createPureLandMaterialSet>;

/** 纹理光栅按像素块让出；取消时销毁所有尚未交付的纹理和材质。 */
export function* createPureLandMaterialsSteps(
  factory: CanvasFactory,
  seed: number,
  anisotropy: number,
  onStage?: BuildStage,
): Generator<void, PureLandMaterials, void> {
  const textures = new Set<Texture>();
  const materials: Material[] = [];
  let completed = false;
  const trackTexture = <T extends Texture>(texture: T): T => {
    textures.add(texture);
    return texture;
  };
  const report = (stage: string): void => onStage?.(`materials:${stage}`);
  const ownMaterial: MaterialOwner = <T extends Material>(material: T): T => {
    materials.push(material);
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    return material;
  };

  try {
    report('stone');
    const stone = trackTexture(
      yield* surfaceTextureSteps(factory, seed, 'stone', (stage) => report(stage)),
    );
    report('carvedStone');
    const carvedStone = trackTexture(
      yield* surfaceTextureSteps(factory, seed, 'carvedStone', (stage) => report(stage)),
    );
    report('gold');
    const gold = trackTexture(
      yield* surfaceTextureSteps(factory, seed + 1, 'gold', (stage) => report(stage)),
    );
    report('wood');
    const wood = trackTexture(
      yield* surfaceTextureSteps(factory, seed + 2, 'wood', (stage) => report(stage)),
    );
    report('roof');
    const roof = trackTexture(
      yield* surfaceTextureSteps(factory, seed + 3, 'roof', (stage) => report(stage)),
    );
    report('leaf');
    const leaf = trackTexture(
      yield* botanicalTextureSteps(factory, true, (stage) => report(stage)),
    );
    report('petal');
    const petal = trackTexture(
      yield* botanicalTextureSteps(factory, false, (stage) => report(stage)),
    );
    report('lily');
    const lily = trackTexture(yield* createLilyTextureSteps(factory, (stage) => report(stage)));
    report('tileEnd');
    const tileEnd = trackTexture(
      yield* ornamentTextureSteps(factory, 'tile', (stage) => report(stage)),
    );
    report('frieze');
    const frieze = trackTexture(
      yield* ornamentTextureSteps(factory, 'frieze', (stage) => report(stage)),
    );
    report('assemble');
    const result = createPureLandMaterialSet(
      stone,
      carvedStone,
      gold,
      wood,
      roof,
      leaf,
      petal,
      lily,
      tileEnd,
      frieze,
      anisotropy,
      trackTexture,
      ownMaterial,
    );
    yield;
    completed = true;
    return result;
  } finally {
    if (!completed) {
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    }
  }
}

export function createPureLandMaterials(
  factory: CanvasFactory,
  seed: number,
  anisotropy: number,
): PureLandMaterials {
  return consume(createPureLandMaterialsSteps(factory, seed, anisotropy));
}

export function* createHallPlaqueSteps(
  factory: CanvasFactory,
  onStage?: BuildStage,
): Generator<void, MeshStandardMaterial, void> {
  const canvas = factory(1024, 256);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建匾额');
  onStage?.('plaque:ground');
  ctx.fillStyle = '#163a32';
  ctx.fillRect(0, 0, 1024, 256);
  yield;
  onStage?.('plaque:border');
  ctx.strokeStyle = '#d1aa60';
  ctx.lineWidth = 7;
  ctx.strokeRect(18, 18, 988, 220);
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, 964, 196);
  yield;
  onStage?.('plaque:lettering');
  ctx.font = '140px "Songti SC", "STSong", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f1d698';
  ctx.fillText(PURE_LAND.views[2].title, 512, 134);
  yield;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  try {
    return new MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.2 });
  } catch (error) {
    texture.dispose();
    throw error;
  }
}

export function createHallPlaque(factory: CanvasFactory): MeshStandardMaterial {
  return consume(createHallPlaqueSteps(factory));
}
