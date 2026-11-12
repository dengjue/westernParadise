/**
 * 庭院材质参数集中表。
 *
 * 这里仅保存颜色、粗糙度和纹理采样参数；CanvasTexture 的绘制算法留在 05-materials，
 * 这样场景布局与渲染实现不会互相复制数值，也方便后续统一调整低饱和色调。
 */
const TEXTURE = Object.freeze({
  width: 96,
  height: 96,
  cellsX: 12,
  cellsY: 12,
} as const);

export const MATERIALS = Object.freeze({
  texture: TEXTURE,
  stone: Object.freeze({
    baseHex: 0x7d8580,
    darkHex: 0x56605d,
    lightHex: 0xaeb0a5,
    roughness: 0.94,
    metalness: 0,
  } as const),
  paving: Object.freeze({
    baseHex: 0x77817d,
    darkHex: 0x4d5a57,
    lightHex: 0xa7aaa0,
    roughness: 0.9,
    metalness: 0,
  } as const),
  wood: Object.freeze({
    baseHex: 0x665d53,
    darkHex: 0x3e3935,
    lightHex: 0x8e8170,
    roughness: 0.82,
    metalness: 0,
  } as const),
  tile: Object.freeze({
    baseHex: 0x455b5c,
    darkHex: 0x2e4143,
    lightHex: 0x6d7d7a,
    roughness: 0.8,
    metalness: 0.02,
  } as const),
  plaster: Object.freeze({
    baseHex: 0xb0aa9b,
    darkHex: 0x817d73,
    lightHex: 0xd2cab8,
    roughness: 0.97,
    metalness: 0,
  } as const),
  leaf: Object.freeze({
    baseHex: 0x536b5c,
    darkHex: 0x2f473d,
    lightHex: 0x7c8d72,
    roughness: 0.95,
    metalness: 0,
  } as const),
  mountain: Object.freeze({
    baseHex: 0x566b6c,
    darkHex: 0x405455,
    lightHex: 0x718382,
    roughness: 1,
    metalness: 0,
  } as const),
  figure: Object.freeze({
    bodyHex: 0x8c9b91,
    headHex: 0xc3c5b8,
    accentHex: 0xa9b8a5,
    pedestalHex: 0x6b7770,
    roughness: 0.76,
    metalness: 0,
  } as const),
} as const);
