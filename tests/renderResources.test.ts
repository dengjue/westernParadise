import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import type { WebGLRenderer } from 'three';
import { createCinematicPipeline, RenderTelemetry } from '@/04-engine';
import { LAND_RENDER } from '@/01-shared';

describe('渲染目标与异步 GPU 计时', () => {
  it('初始化/同尺寸 resize 预算一致；缩放只应用一次，目标为整数像素并可恢复', () => {
    let pixelRatio = 1.5;
    const renderer = { getPixelRatio: () => pixelRatio } as WebGLRenderer;
    const pipeline = createCinematicPipeline(
      renderer,
      new Scene(),
      new PerspectiveCamera(),
      'high',
      1601,
      997,
    );
    const initial = { ...pipeline.stats };
    expect(initial.postWidth).toBe(1601);
    expect(initial.postHeight).toBe(997);
    pipeline.resize(1601, 997);
    expect(pipeline.stats).toEqual(initial);
    pixelRatio = 1.2;
    pipeline.setScale(0.8);
    expect(pipeline.stats.postWidth).toBe(1280);
    expect(pipeline.stats.postHeight).toBe(797);
    expect(pipeline.stats.estimatedTargetBytes).toBeLessThan(initial.estimatedTargetBytes);
    pipeline.setScale(1);
    expect(pipeline.stats).toEqual(initial);
    pipeline.dispose();
  });

  it('无扩展时仍记录 CPU，查询池饱和时跳过而不等待，完成后才读取 GPU 结果', () => {
    const gl = {
      getExtension: vi.fn(() => null as object | null),
      getParameter: vi.fn(() => false),
      createQuery: vi.fn(() => ({})),
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      deleteQuery: vi.fn(),
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getQueryParameter: vi.fn((_query: object, key: number): number | boolean =>
        key === 1 ? false : 2500000,
      ),
    };
    const renderer = { getContext: () => gl } as unknown as WebGLRenderer;
    const unsupported = new RenderTelemetry(renderer, true);
    unsupported.begin(10);
    unsupported.end(12);
    expect(unsupported.stats).toMatchObject({ cpuMs: 2, gpuMs: null, gpuAvailable: false });
    unsupported.dispose();
    gl.getExtension.mockReturnValue({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 });
    const supported = new RenderTelemetry(renderer, true);
    for (let i = 0; i < LAND_RENDER.timerQueries + 2; i++) {
      supported.begin(i * 10);
      supported.end(i * 10 + 1);
    }
    expect(gl.beginQuery).toHaveBeenCalledTimes(LAND_RENDER.timerQueries);
    expect(
      gl.getQueryParameter.mock.calls.every(([, key]) => key === gl.QUERY_RESULT_AVAILABLE),
    ).toBe(true);
    gl.getQueryParameter.mockImplementation((_query, key) => (key === 1 ? true : 2500000));
    supported.begin(100);
    supported.end(101);
    expect(supported.stats.gpuMs).toBe(2.5);
    expect(supported.stats.gpuSamples).toBe(LAND_RENDER.timerQueries);
    gl.getParameter.mockReturnValue(true);
    supported.begin(110);
    supported.end(112);
    expect(supported.stats.gpuMs).toBeNull();
    expect(supported.stats.gpuDisjoints).toBe(1);
    supported.dispose();
    expect(gl.deleteQuery).toHaveBeenCalledTimes(LAND_RENDER.timerQueries);
  });
});
