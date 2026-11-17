import { describe, expect, it, vi } from 'vitest';
import { decodePaethRowsInPlace, loadLandPmremAtlas } from '../src/06-world/land/LandPmremAtlas';

describe('offline PMREM atlas', () => {
  it('reconstructs the bundled RGB16F faces into three six-level RGBA atlases', async () => {
    const atlas = await loadLandPmremAtlas(new AbortController().signal);

    expect(atlas.stats).toMatchObject({
      compressedBytes: 1_426_384,
      decodedBytes: 9_434_880,
    });
    expect(atlas.stats.yieldedFrames).toBeGreaterThan(0);
    expect(atlas.textures).toHaveLength(3);
    for (const texture of atlas.textures) {
      expect(texture.image.width).toBe(256);
      expect(texture.image.height).toBe(1536);
      expect(texture.mipmaps).toHaveLength(6);
      expect(texture.image.data).toHaveLength(256 * 1536 * 4);
    }
    // 来自 Chromium/Firefox WebGL2 原型读回的第一个 dawn +X half-float texel。
    expect(atlas.textures[0]!.image.data?.slice(0, 4)).toEqual(
      new Uint16Array([14834, 14837, 14665, 15360]),
    );
    const disposals = atlas.textures.map((texture) => vi.spyOn(texture, 'dispose'));
    atlas.dispose();
    atlas.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('stops between decode slices when cancelled', async () => {
    const controller = new AbortController();
    const load = loadLandPmremAtlas(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(load).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('unfilters Paeth rows in place using already restored neighbors', () => {
    // 原像素行分别为 [10, 20, 30] 和 [11, 25, 31]；
    // 下方数据由左、上及左上预测值编码而成。
    const residual = new Uint8Array([10, 10, 10, 1, 5, 1]);

    decodePaethRowsInPlace(residual, 3, 0, 2);

    expect(residual).toEqual(new Uint8Array([10, 20, 30, 11, 25, 31]));
    expect(() => decodePaethRowsInPlace(new Uint8Array(2), 3, 0, 1)).toThrow(RangeError);
  });
});
