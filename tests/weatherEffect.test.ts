import { describe, expect, it } from 'vitest';
import { Group, LineSegments } from 'three';
import { WEATHER_PRESETS, WORLD } from '@/01-shared';
import { WeatherEffect } from '@/06-world';

function createEffect(
  seed: number,
  reducedMotion = false,
): { parent: Group; effect: WeatherEffect } {
  const parent = new Group();
  const effect = new WeatherEffect({
    parent,
    seed,
    presets: Object.values(WEATHER_PRESETS),
    preset: WEATHER_PRESETS.rain,
    reducedMotion,
  });
  return { parent, effect };
}

function getRainLines(parent: Group): LineSegments {
  const lines = parent.getObjectByName('weather-rain');
  expect(lines).toBeInstanceOf(LineSegments);
  return lines as LineSegments;
}

describe('WeatherEffect', () => {
  it('同一种子生成相同雨丝，并在固定步长后更新位置', () => {
    const first = createEffect(20261112);
    const second = createEffect(20261112);
    const firstLines = getRainLines(first.parent);
    const secondLines = getRainLines(second.parent);
    const firstAttribute = firstLines.geometry.getAttribute('position');
    const secondAttribute = secondLines.geometry.getAttribute('position');

    expect(firstLines.visible).toBe(true);
    expect(firstLines.geometry.drawRange.count).toBe(
      WEATHER_PRESETS.rain.precipitation.particleCount * 2,
    );
    expect(Array.from(firstAttribute.array as Float32Array)).toEqual(
      Array.from(secondAttribute.array as Float32Array),
    );

    const before = Array.from(firstAttribute.array as Float32Array);
    first.effect.update(1000 / 60);
    expect(Array.from(firstAttribute.array as Float32Array)).not.toEqual(before);

    const firstPosition = firstAttribute.array as Float32Array;
    expect(firstPosition[0]).toBeGreaterThanOrEqual(WORLD.bounds.minX);
    expect(firstPosition[0]).toBeLessThanOrEqual(WORLD.bounds.maxX);
    expect(firstPosition[2]).toBeGreaterThanOrEqual(WORLD.bounds.minZ);
    expect(firstPosition[2]).toBeLessThanOrEqual(WORLD.bounds.maxZ);
  });

  it('晴与雾隐藏粒子，减少动态效果时雨也不显示', () => {
    const normal = createEffect(42);
    const lines = getRainLines(normal.parent);

    normal.effect.applyWeather(WEATHER_PRESETS.clear);
    expect(lines.visible).toBe(false);
    expect(lines.geometry.drawRange.count).toBe(0);

    normal.effect.applyWeather(WEATHER_PRESETS.mist);
    expect(lines.visible).toBe(false);

    const reduced = createEffect(42, true);
    expect(getRainLines(reduced.parent).visible).toBe(false);
  });
});
