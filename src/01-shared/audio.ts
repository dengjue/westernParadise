/**
 * 程序化自然声的唯一参数表。
 * 数值只描述音色与节奏，不包含任何外部资源路径；03-platform 的音频层只读取这里的冻结值。
 */
export const AUDIO = Object.freeze({
  masterGain: 0.16,
  noiseBufferSeconds: 2,
  fadeSeconds: 0.12,
  wind: Object.freeze({
    lowPassHz: 420,
    gain: 0.045,
  } as const),
  distant: Object.freeze({
    lowPassHz: 120,
    gain: 0.018,
  } as const),
  rain: Object.freeze({
    highPassHz: 1500,
    gain: 0.055,
  } as const),
  footsteps: Object.freeze({
    groundFrequencyHz: 110,
    platformFrequencyHz: 145,
    gain: 0.055,
    attackSeconds: 0.004,
    releaseSeconds: 0.09,
  } as const),
  bell: Object.freeze({
    intervalMs: 16000,
    frequencyHz: 392,
    gain: 0.035,
    attackSeconds: 0.02,
    releaseSeconds: 2.1,
  } as const),
} as const);
