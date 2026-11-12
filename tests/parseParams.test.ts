import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED } from '@/01-shared';
import { Rng } from '@/02-core';
import { parseParams } from '@/03-platform';

describe('parseParams', () => {
  it('空参数返回安全默认值', () => {
    expect(parseParams('')).toEqual({
      quality: null,
      tod: 'noon',
      weather: 'clear',
      seed: DEFAULT_SEED,
      bench: false,
      smoke: false,
      debug: false,
      noAudio: false,
    });
  });

  it('识别全部合法参数，支持 q 作为 quality 别名', () => {
    const result = parseParams('?q=HIGH&seed=42&bench&smoke&debug&noaudio');
    expect(result.quality).toBe('high');
    expect(result.tod).toBe('noon');
    expect(result.weather).toBe('clear');
    expect(result.seed).toBe(42);
    expect(result.bench).toBe(true);
    expect(result.smoke).toBe(true);
    expect(result.debug).toBe(true);
    expect(result.noAudio).toBe(true);
  });

  it('非法档位与非法种子一律回退，不抛错', () => {
    expect(() => parseParams('?quality=ultraaaa&seed=abc')).not.toThrow();
    const result = parseParams('?quality=ultraaaa&seed=abc');
    expect(result.quality).toBeNull();
    expect(result.seed).toBe(DEFAULT_SEED);
  });

  it('负数 / 小数 / 溢出种子回退默认值', () => {
    expect(parseParams('?seed=-1').seed).toBe(DEFAULT_SEED);
    expect(parseParams('?seed=1.5').seed).toBe(DEFAULT_SEED);
    expect(parseParams('?seed=99999999999999999999').seed).toBe(DEFAULT_SEED);
    expect(parseParams('?seed=0').seed).toBe(0);
  });

  it('开关显式写 0 / false / off 可关闭', () => {
    expect(parseParams('?bench=0').bench).toBe(false);
    expect(parseParams('?smoke=false').smoke).toBe(false);
    expect(parseParams('?debug=OFF').debug).toBe(false);
    expect(parseParams('?bench=1').bench).toBe(true);
  });

  it('是否带前导问号都能解析', () => {
    expect(parseParams('seed=7').seed).toBe(7);
    expect(parseParams('?seed=7').seed).toBe(7);
  });

  it('识别合法时段与天气参数', () => {
    const result = parseParams('?tod=DAWN&weather=MIST');
    expect(result.tod).toBe('dawn');
    expect(result.weather).toBe('mist');
  });

  it('非法时段与天气回落默认值并发出警告', () => {
    const warnings: string[] = [];
    const result = parseParams('?tod=abc&weather=storm', (message) => warnings.push(message));
    expect(result.tod).toBe('noon');
    expect(result.weather).toBe('clear');
    expect(warnings).toEqual([
      '非法 tod 参数「abc」，已回落到 noon',
      '非法 weather 参数「storm」，已回落到 clear',
    ]);
  });

  it('?seed=42 注入 Rng 后两次序列完全一致', () => {
    const seed = parseParams('?seed=42').seed;
    const first = new Rng(seed);
    const second = new Rng(seed);
    const firstSequence = Array.from({ length: 8 }, () => first.next());
    const secondSequence = Array.from({ length: 8 }, () => second.next());

    expect(firstSequence).toEqual(secondSequence);
  });
});
