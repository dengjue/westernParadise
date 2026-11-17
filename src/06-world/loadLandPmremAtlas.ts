import type { LandPmremAtlasHandle } from './land/LandPmremAtlas';

/** 只在第三人称原型请求时加载随包环境数据，默认第一人称不触发图集模块求值。 */
export function loadLandPmremAtlas(
  signal: AbortSignal,
  onStage?: (stage: string) => void,
): Promise<LandPmremAtlasHandle> {
  return import('./land/LandPmremAtlas').then(({ loadLandPmremAtlas: load }) =>
    load(signal, onStage),
  );
}
