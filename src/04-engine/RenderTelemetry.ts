import type { WebGLRenderer } from 'three';
import { LAND_RENDER } from '@/01-shared';

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** GPU 查询异步取回；不等待未完成结果，不嵌套反射查询，不把 JS 提交耗时当 GPU 时间。 */
export class RenderTelemetry {
  readonly stats = {
    cpuMs: 0,
    gpuMs: null as number | null,
    gpuSamples: 0,
    gpuAvailable: false,
    gpuDisjoints: 0,
  };
  private readonly gl: WebGL2RenderingContext;
  private readonly extension: TimerExtension | null;
  private readonly queries: WebGLQuery[] = [];
  private readonly pending: boolean[] = [];
  private active = -1;
  private startedAt = 0;

  constructor(renderer: WebGLRenderer, enabled: boolean) {
    // 当前 Three.js WebGLRenderer 只创建 WebGL2，类型声明仍兼容历史 WebGL1。
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.extension = enabled
      ? (this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null)
      : null;
    if (this.extension)
      for (let i = 0; i < LAND_RENDER.timerQueries; i++) {
        const query = this.gl.createQuery();
        if (query) {
          this.queries.push(query);
          this.pending.push(false);
        }
      }
    this.stats.gpuAvailable = this.queries.length > 0;
  }

  begin(now: number): void {
    this.startedAt = now;
    if (!this.extension) return;
    const disjoint = this.gl.getParameter(this.extension.GPU_DISJOINT_EXT) as boolean;
    if (disjoint) {
      // 时钟重置使所有未取回时间无效；这一帧也不启动查询，避免把旧数值冒充新样本。
      this.pending.fill(false);
      this.stats.gpuMs = null;
      this.stats.gpuDisjoints++;
      return;
    }
    for (let i = 0; i < this.queries.length; i++) {
      if (!this.pending[i]) continue;
      const query = this.queries[i]!;
      if (this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) {
        this.stats.gpuMs = (this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number) / 1e6;
        this.stats.gpuSamples++;
        this.pending[i] = false;
      }
    }
    this.active = this.pending.indexOf(false);
    if (this.active >= 0)
      this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, this.queries[this.active]!);
  }

  end(now: number): void {
    this.stats.cpuMs = now - this.startedAt;
    if (this.extension && this.active >= 0) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending[this.active] = true;
      this.active = -1;
    }
  }

  dispose(): void {
    if (this.extension && this.active >= 0) this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.active = -1;
    for (const query of this.queries) this.gl.deleteQuery(query);
    this.queries.length = 0;
    this.pending.length = 0;
  }
}
