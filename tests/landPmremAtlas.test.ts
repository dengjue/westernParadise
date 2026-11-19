import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePaethRowsInPlace, loadLandPmremAtlas } from '../src/06-world/land/LandPmremAtlas';

describe('offline PMREM atlas', () => {
  it('reconstructs the bundled RGB16F faces into three five-level RGBA atlases', async () => {
    const atlas = await loadLandPmremAtlas(new AbortController().signal);

    expect(atlas.stats).toMatchObject({
      compressedBytes: 429_554,
      decodedBytes: 2_356_992,
    });
    expect(atlas.stats.yieldedFrames).toBeGreaterThan(0);
    expect(atlas.textures).toHaveLength(3);
    for (const texture of atlas.textures) {
      expect(texture.image.width).toBe(128);
      expect(texture.image.height).toBe(768);
      expect(texture.mipmaps).toHaveLength(5);
      expect(texture.image.data).toHaveLength(128 * 768 * 4);
    }
    // dawn +X 128px mip 的第一个 half-float texel。
    expect(atlas.textures[0]!.image.data?.slice(0, 4)).toEqual(
      new Uint16Array([14779, 14787, 14625, 15360]),
    );
    const disposals = atlas.textures.map((texture) => vi.spyOn(texture, 'dispose'));
    atlas.dispose();
    atlas.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('rebuilds the checked-in compact asset deterministically from its full source', () => {
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const generatedPath = path.join(projectRoot, 'src/06-world/land/land-pmrem-v187-mip128.gz');
    const generatorPath = path.join(projectRoot, 'scripts/prepare-land-pmrem-atlas.mjs');
    const sourcePath = path.join(projectRoot, 'scripts/assets/land-pmrem-v187-source.gz');
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'land-pmrem-atlas-'));
    const outputPath = path.join(temporaryDirectory, 'rebuilt.gz');

    try {
      execFileSync(process.execPath, [generatorPath, sourcePath, outputPath], { cwd: projectRoot });
      expect(readFileSync(outputPath)).toEqual(readFileSync(generatedPath));
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
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
