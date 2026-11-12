import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED } from '@/01-shared';
import { parseParams } from '@/03-platform';

describe('parseParams', () => {
  it('空参数返回安全默认值', () => {
    expect(parseParams('')).toEqual({
      quality: null,
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
});
