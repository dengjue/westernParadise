/**
 * 程序化噪声：后续 DataTexture / CanvasTexture 生成木石瓦纸纹理的公共底座。
 *
 * 为什么单独一层且不依赖 three：
 * 噪声是纯数据算法，与渲染引擎无关；拆出来可以在 Node 单测里验证确定性与值域，
 * 也避免以后「材质层牵一发动全身」。当前只实现值噪声，接口留好扩展点。
 */

export interface NoiseOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** 横向/纵向格点数，越大纹理越细碎。 */
  readonly cellsX: number;
  readonly cellsY: number;
}

/** 整数格点哈希，返回 [0, 1)。用 Math.imul 保证 32 位溢出行为跨平台一致。 */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 三次平滑插值，消除格点边界的方块感。 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 生成 width × height 的灰度噪声（0–255），行优先一维数组。
 * 同 seed 与同参数必然逐字节一致，配合 ?seed= 可复现材质表现。
 */
export function valueNoise(options: NoiseOptions): Uint8Array {
  const { width, height, seed, cellsX, cellsY } = options;
  if (width <= 0 || height <= 0 || cellsX <= 0 || cellsY <= 0) {
    throw new RangeError('width / height / cellsX / cellsY 必须为正数');
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const gy = (y / height) * cellsY;
    const iy = Math.floor(gy);
    const ty = smoothstep(gy - iy);
    for (let x = 0; x < width; x += 1) {
      const gx = (x / width) * cellsX;
      const ix = Math.floor(gx);
      const tx = smoothstep(gx - ix);

      const v00 = lattice(ix, iy, seed);
      const v10 = lattice(ix + 1, iy, seed);
      const v01 = lattice(ix, iy + 1, seed);
      const v11 = lattice(ix + 1, iy + 1, seed);
      const top = v00 + (v10 - v00) * tx;
      const bottom = v01 + (v11 - v01) * tx;
      const value = top + (bottom - top) * ty;
      out[y * width + x] = Math.round(value * 255);
    }
  }
  return out;
}
