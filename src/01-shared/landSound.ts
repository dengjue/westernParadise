/** 程序化自然声按相机与景观的距离渐变；不创建远程音源。 */
export const LAND_SOUND = Object.freeze({
  updateMs: 200,
  fadeSeconds: 0.6,
  defaultVolume: 0.6,
  water: { x: 28, y: 0, z: 28, radius: 75, highPassHz: 320, lowPassHz: 1800, gain: 0.055 },
  grove: { x: 43, y: 4, z: -8, radius: 85 },
  bell: { x: 63, y: 7, z: -53, radius: 75 },
  bird: { intervalMs: 11000, frequencyHz: 1650, riseHz: 2550, gain: 0.024, duration: 0.32 },
} as const);
