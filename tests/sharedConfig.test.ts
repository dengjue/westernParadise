import { describe, expect, it } from 'vitest';
import type { GuideId, TimeOfDayId, WeatherId } from '@/00-types';
import {
  COPY,
  DEFAULT_TIME_OF_DAY_ID,
  DEFAULT_WEATHER_ID,
  GUIDE_ENTRIES,
  TIME_OF_DAY_PRESETS,
  WEATHER_PRESETS,
  WORLD,
} from '@/01-shared';

const TIME_OF_DAY_IDS: readonly TimeOfDayId[] = ['dawn', 'noon', 'dusk'];
const WEATHER_IDS: readonly WeatherId[] = ['clear', 'mist', 'rain'];
const GUIDE_IDS: readonly GuideId[] = ['taiji', 'zhulie', 'wuyan', 'puzhuang'];

/** 递归检查配置树，防止只冻结外层而让嵌套参数在运行中被改写。 */
function expectDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    expectDeepFrozen(child);
  }
}

describe('01-shared M1 配置', () => {
  it('世界、时段、天气、导览和文案配置全部递归冻结', () => {
    expectDeepFrozen(WORLD);
    expectDeepFrozen(TIME_OF_DAY_PRESETS);
    expectDeepFrozen(WEATHER_PRESETS);
    expectDeepFrozen(GUIDE_ENTRIES);
    expectDeepFrozen(COPY);

    expect(() => {
      (WORLD.spawn as unknown as { x: number }).x = 99;
    }).toThrow(TypeError);
    expect(() => {
      (TIME_OF_DAY_PRESETS.dawn.sun as unknown as { intensity: number }).intensity = 99;
    }).toThrow(TypeError);
    expect(() => {
      (WEATHER_PRESETS.mist.fogScale as unknown as { near: number }).near = 99;
    }).toThrow(TypeError);
    expect(() => {
      (COPY.guide.taiji as unknown as { title: string }).title = '改写';
    }).toThrow(TypeError);
  });

  it('时段表恰好包含晨、午、暮三档，且 ID 与键一致', () => {
    expect(Object.keys(TIME_OF_DAY_PRESETS).sort()).toEqual([...TIME_OF_DAY_IDS].sort());

    for (const id of TIME_OF_DAY_IDS) {
      const preset = TIME_OF_DAY_PRESETS[id];
      expect(preset.id).toBe(id);
      expect(preset.label).toBe(COPY.timeOfDay[id]);
      expect(preset.sun.elevationDeg).toBeGreaterThanOrEqual(0);
      expect(preset.sun.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(preset.fog.near).toBeLessThan(preset.fog.far);
    }

    expect(DEFAULT_TIME_OF_DAY_ID).toBe('noon');
  });

  it('天气表包含晴、雾与雨，并保留规范中的倍率和雨效参数', () => {
    expect(Object.keys(WEATHER_PRESETS).sort()).toEqual([...WEATHER_IDS].sort());
    expect(WEATHER_PRESETS.clear.fogScale).toEqual({ near: 1, far: 1 });
    expect(WEATHER_PRESETS.mist.fogScale).toEqual({ near: 0.35, far: 0.45 });
    expect(WEATHER_PRESETS.rain.precipitation.effect).toBe('rain');
    expect(WEATHER_PRESETS.rain.precipitation.particleCount).toBeGreaterThan(0);
    expect(DEFAULT_WEATHER_ID).toBe('clear');
  });

  it('文案表恰好包含四条建筑说明，标题正文均非空', () => {
    expect(Object.keys(COPY.guide).sort()).toEqual([...GUIDE_IDS].sort());

    for (const id of GUIDE_IDS) {
      const copy = COPY.guide[id];
      expect(copy.title.trim()).not.toBe('');
      expect(copy.body.trim()).not.toBe('');
    }
  });

  it('四个导览触发点的 ID、文案键、位置和半径均合法', () => {
    expect(Object.keys(GUIDE_ENTRIES).sort()).toEqual([...GUIDE_IDS].sort());

    for (const id of GUIDE_IDS) {
      const entry = GUIDE_ENTRIES[id];
      expect(entry.id).toBe(id);
      expect(entry.copyKey).toBe(id);
      expect(Number.isFinite(entry.position.x)).toBe(true);
      expect(Number.isFinite(entry.position.y)).toBe(true);
      expect(Number.isFinite(entry.position.z)).toBe(true);
      expect(entry.radius).toBeGreaterThan(0);
    }
  });

  it('世界边界由庭院尺寸向内收缩半米得到', () => {
    expect(WORLD.courtyard).toEqual({ width: 44, depth: 34 });
    expect(WORLD.bounds).toEqual({
      minX: -21.5,
      maxX: 21.5,
      minZ: -16.5,
      maxZ: 16.5,
    });
  });
});
