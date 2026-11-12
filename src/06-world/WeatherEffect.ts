import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments } from 'three';
import type { WeatherPreset } from '@/00-types';
import { WORLD } from '@/01-shared';
import { Rng } from '@/02-core';

export interface WeatherEffectOptions {
  readonly parent: Group;
  readonly seed: number;
  readonly presets: readonly WeatherPreset[];
  readonly preset: WeatherPreset;
  readonly reducedMotion: boolean;
}

/**
 * 天气粒子层只创建一份雨丝缓冲区，切换天气时复用它的绘制范围与材质参数。
 * 所有位置由固定 seed 初始化，更新阶段只改 Float32Array，不创建临时几何体。
 */
export class WeatherEffect {
  readonly root: Group;

  private readonly geometry: BufferGeometry;
  private readonly material: LineBasicMaterial;
  private readonly lines: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly positions: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly rng: Rng;
  private readonly maxParticles: number;
  private readonly reducedMotion: boolean;
  private activePreset: WeatherPreset;
  private activeCount = 0;

  constructor(options: WeatherEffectOptions) {
    this.root = new Group();
    this.root.name = 'weather-effect';
    this.rng = new Rng(options.seed);
    this.reducedMotion = options.reducedMotion;
    this.maxParticles = options.presets.reduce(
      (maximum, preset) => Math.max(maximum, preset.precipitation.particleCount),
      0,
    );
    this.positions = new Float32Array(this.maxParticles * 6);
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setDrawRange(0, 0);
    this.material = new LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    this.lines = new LineSegments(this.geometry, this.material);
    this.lines.name = 'weather-rain';
    this.lines.frustumCulled = false;
    this.root.add(this.lines);
    options.parent.add(this.root);
    this.activePreset = options.preset;
    this.applyWeather(options.preset);
  }

  applyWeather(preset: WeatherPreset): void {
    this.activePreset = preset;
    const precipitation = preset.precipitation;
    this.activeCount = Math.min(precipitation.particleCount, this.maxParticles);
    this.geometry.setDrawRange(0, this.activeCount * 2);
    this.material.color.setHex(precipitation.colorHex);
    this.material.opacity = precipitation.opacity;
    this.lines.visible =
      !this.reducedMotion && precipitation.effect === 'rain' && this.activeCount > 0;

    if (this.lines.visible) {
      for (let index = 0; index < this.activeCount; index += 1) {
        this.resetParticle(index);
      }
    }
    this.positionAttribute.needsUpdate = true;
  }

  update(deltaMs: number): void {
    if (!this.lines.visible || this.activeCount === 0) {
      return;
    }

    const precipitation = this.activePreset.precipitation;
    const deltaSeconds = deltaMs / 1000;
    const baseY = WORLD.ground.baseHeight;
    const minX = WORLD.bounds.minX;
    const maxX = WORLD.bounds.maxX;
    const width = maxX - minX;

    for (let index = 0; index < this.activeCount; index += 1) {
      const offset = index * 6;
      let x = this.positions[offset] ?? minX;
      const nextTopY =
        (this.positions[offset + 1] ?? baseY) - precipitation.fallSpeed * deltaSeconds;
      x += this.activePreset.windStrength * deltaSeconds;
      if (x > maxX) {
        x = minX + ((x - maxX) % width);
      }

      if (nextTopY - precipitation.dropLength <= baseY) {
        this.resetParticle(index);
        continue;
      }

      this.positions[offset] = x;
      this.positions[offset + 1] = nextTopY;
      this.positions[offset + 3] = x;
      this.positions[offset + 4] = nextTopY - precipitation.dropLength;
    }
    this.positionAttribute.needsUpdate = true;
  }

  private resetParticle(index: number): void {
    const precipitation = this.activePreset.precipitation;
    const offset = index * 6;
    const baseY = WORLD.ground.baseHeight;
    const minTopY = baseY + Math.min(precipitation.dropLength, precipitation.areaHeight);
    const maxTopY = baseY + precipitation.areaHeight;
    const topY = this.rng.range(minTopY, Math.max(minTopY, maxTopY));
    const x = this.rng.range(WORLD.bounds.minX, WORLD.bounds.maxX);
    const z = this.rng.range(WORLD.bounds.minZ, WORLD.bounds.maxZ);

    this.positions[offset] = x;
    this.positions[offset + 1] = topY;
    this.positions[offset + 2] = z;
    this.positions[offset + 3] = x;
    this.positions[offset + 4] = topY - precipitation.dropLength;
    this.positions[offset + 5] = z;
  }
}
