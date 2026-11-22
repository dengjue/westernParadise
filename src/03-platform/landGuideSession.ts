import { LAND_STOPS, LAND_TOURS, STORAGE_NAMESPACE } from '@/01-shared';

export interface LandGuideProgress {
  choice: string;
  stage: number;
}

const KEY = `${STORAGE_NAMESPACE}:guide:v1`;

/** 只认当前游线和合法站次；完成状态用站点总数表示。 */
export function decodeLandGuideProgress(raw: string | null): LandGuideProgress | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('choice' in value) || !('stage' in value))
      return null;
    const { choice, stage } = value;
    if (
      typeof choice !== 'string' ||
      typeof stage !== 'number' ||
      !Number.isSafeInteger(stage) ||
      stage < 0
    )
      return null;
    const tour = LAND_TOURS.find((t) => t.id === choice);
    if (
      tour
        ? stage > tour.stops.length
        : stage !== 0 || !LAND_STOPS.some((stop) => stop.id === choice)
    )
      return null;
    return { choice, stage };
  } catch {
    return null;
  }
}

export function readLandGuideSession(): LandGuideProgress | null {
  try {
    return decodeLandGuideProgress(window.sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeLandGuideSession(progress: LandGuideProgress | null): void {
  try {
    if (progress) window.sessionStorage.setItem(KEY, JSON.stringify(progress));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* 隐私模式不可写时，继续本页游览。 */
  }
}
