import type { Capabilities, PlatformEnv } from '@/00-types';

/**
 * 设备能力探测。
 * detectCapabilities 是纯函数；所有浏览器 API 只出现在 readBrowserEnv() 里，
 * 这样「低端机 / 触屏 / 无 WebGL / 减动效」四类降级都能在 Node 单测中穷举覆盖。
 */

const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile|Silk|HarmonyOS/i;

export function detectCapabilities(env: PlatformEnv): Capabilities {
  return Object.freeze({
    webgl: env.webgl2 ? 'webgl2' : env.webgl1 ? 'webgl1' : 'none',
    touch: env.maxTouchPoints > 0,
    mobile: env.maxTouchPoints > 0 && MOBILE_UA_PATTERN.test(env.userAgent),
    reducedMotion: env.reducedMotion,
    // 某些浏览器返回 0 或 undefined，兜到 1 避免后续除零与误判为高配。
    hardwareConcurrency: Math.max(1, Math.floor(env.hardwareConcurrency) || 1),
    deviceMemoryGb: env.deviceMemoryGb,
    // 钳制到 [1, 3]：低于 1 无意义，过高会让 4K/Retina 设备像素量爆炸。
    pixelRatio: Math.min(Math.max(env.devicePixelRatio || 1, 1), 3),
  });
}

/** 探测 WebGL 支持；用完立刻释放上下文，避免占用浏览器的上下文配额。 */
function probeWebGL(): { webgl2: boolean; webgl1: boolean } {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      gl2.getExtension('WEBGL_lose_context')?.loseContext();
      return { webgl2: true, webgl1: true };
    }
    const gl1 = canvas.getContext('webgl');
    if (gl1) {
      gl1.getExtension('WEBGL_lose_context')?.loseContext();
      return { webgl2: false, webgl1: true };
    }
  } catch {
    // 隐私模式 / 禁用 canvas 时可能抛错，按「不支持」处理，由 UI 给出明确提示。
  }
  return { webgl2: false, webgl1: false };
}

/** 读取真实浏览器环境。只在 boot 阶段调用一次。 */
export function readBrowserEnv(): PlatformEnv {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const { webgl2, webgl1 } = probeWebGL();
  return Object.freeze({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hardwareConcurrency: nav.hardwareConcurrency ?? 1,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    devicePixelRatio: window.devicePixelRatio ?? 1,
    webgl2,
    webgl1,
  });
}
