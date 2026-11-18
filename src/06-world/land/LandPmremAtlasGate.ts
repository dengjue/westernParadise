import type { LandPmremAtlasHandle } from './LandPmremAtlas';

type GateState = 'pending' | 'ready' | 'taken' | 'failed' | 'transferred' | 'disposed';

/**
 * 在离线 PMREM 解码与第三人称世界构建之间传递唯一所有权。
 * gate 在 world 完整装配前持有图集；取消/失败会释放它，成功则转交给 world。
 */
export class LandPmremAtlasGate {
  private state: GateState = 'pending';
  private handle: LandPmremAtlasHandle | undefined;
  private failure: unknown;

  get pending(): boolean {
    return this.state === 'pending';
  }

  resolve(handle: LandPmremAtlasHandle): void {
    if (this.state !== 'pending') {
      handle.dispose();
      return;
    }
    this.handle = handle;
    this.state = 'ready';
  }

  reject(error: unknown): void {
    if (this.state !== 'pending') return;
    this.failure = error;
    this.state = 'failed';
  }

  *wait(): Generator<void, LandPmremAtlasHandle, void> {
    while (this.state === 'pending') yield;
    if (this.state === 'failed') throw this.failure;
    if (this.state === 'disposed')
      throw Object.assign(new Error('PMREM 图集等待已取消'), { name: 'AbortError' });
    if (this.state !== 'ready' || !this.handle)
      throw new Error(`PMREM 图集 gate 状态无效：${this.state}`);
    this.state = 'taken';
    return this.handle;
  }

  /** world 已完整接管 atlas；后续资源释放由 world environment 负责。 */
  transfer(): void {
    if (this.state !== 'taken' || !this.handle)
      throw new Error(`无法转交 PMREM 图集：${this.state}`);
    this.handle = undefined;
    this.state = 'transferred';
  }

  dispose(): void {
    if (this.state === 'disposed' || this.state === 'transferred') return;
    const handle = this.handle;
    this.handle = undefined;
    this.state = 'disposed';
    handle?.dispose();
  }
}
