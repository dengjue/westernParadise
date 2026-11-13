import { describe, expect, it } from 'vitest';
import { summarizeLightingTrace } from './summarize-lighting-trace.mjs';

function fixture() {
  const columns = [
    'rafMs',
    'deltaMs',
    'appFrames',
    'segment',
    'pipelineCpuMs',
    'calls',
    'triangles',
    'reflectionRendered',
    'probeMs',
    'activityMask',
  ];
  const rows = [
    [110, 100, 1, 0, 60, 10, 100, 1, 0.1, 0],
    [120, 10, 1, 0, 5, 10, 100, 1, 0.1, 0],
    [130, 10, 1, 0, 2, 5, 50, 0, 0, 0],
  ];
  return {
    columns,
    values: rows.flat(),
    frames: 3,
    failure: null,
    entryOverflow: false,
    detailed: true,
    entries: [],
    segments: [
      {
        id: 0,
        kind: 'measured',
        round: 1,
        to: 'noon',
        startMs: 105,
        endMs: 131,
        startRow: 0,
        endRow: 3,
        continuous: true,
        before: { shadowRequests: 0, reflectionUpdates: 0 },
        after: { shadowRequests: 1, reflectionUpdates: 1 },
      },
    ],
  };
}

describe('光阴逐帧证据的验收口径', () => {
  it('单列跨边界长帧且仍阻止严格验收通过，并区分倒影更新/缓存帧', () => {
    const result = summarizeLightingTrace(fixture());
    expect(result.targetMet).toBe(false);
    expect(result.segments[0].boundaryFrames).toBe(1);
    expect(result.segments[0].frameMs.max).toBe(100);
    expect(result.segments[0].interiorFrameMs.max).toBe(10);
    expect(result.segments[0].reflectionCpuMs.updated.p95).toBe(60);
    expect(result.segments[0].reflectionCpuMs.cached.p95).toBe(2);
    expect(result.segments[0].calls).not.toHaveProperty('over50ms');
  });
  it('失焦或没有实际绘制的一行，使整个有效负载断言失败', () => {
    for (const name of ['activityMask', 'appFrames']) {
      const trace = fixture();
      trace.values[trace.columns.length + trace.columns.indexOf(name)] =
        name === 'appFrames' ? 0 : 2;
      expect(summarizeLightingTrace(trace).valid).toBe(false);
    }
  });
  it('将跨越采样窗口的长任务关联进来，不混入结束后的启动/其他任务', () => {
    const trace = fixture();
    trace.entries = [
      { entryType: 'longtask', startTime: 90, duration: 20 },
      { entryType: 'longtask', startTime: 132, duration: 80 },
    ];
    expect(summarizeLightingTrace(trace).segments[0].longTasks).toBe(1);
  });
  it('有界记录溢出、超时或空窗口不能误报达标', () => {
    const overflow = fixture();
    overflow.entryOverflow = true;
    expect(summarizeLightingTrace(overflow).valid).toBe(false);
    const timeout = fixture();
    timeout.failure = '超时';
    expect(summarizeLightingTrace(timeout).targetMet).toBe(false);
    const empty = fixture();
    empty.segments[0].endRow = 1;
    expect(summarizeLightingTrace(empty).valid).toBe(false);
  });
  it('两帧之间的失焦以及损坏的原始表仍会被发现', () => {
    const trace = fixture();
    trace.activity = [
      { type: 'blur', mask: 2 },
      { type: 'focus', mask: 0 },
    ];
    expect(summarizeLightingTrace(trace).valid).toBe(false);
    trace.values.pop();
    expect(() => summarizeLightingTrace(trace)).toThrow('逐帧表长度');
  });
  it('16.7ms 的二进制尾差不会误判，但实际 16.8ms 仍不达标', () => {
    const trace = fixture(),
      width = trace.columns.length;
    trace.values[1] = 5;
    trace.values[width + 1] = 16.700000000000728;
    trace.values[width * 2 + 1] = 16.7;
    expect(summarizeLightingTrace(trace).targetMet).toBe(true);
    trace.values[width + 1] = 16.8;
    expect(summarizeLightingTrace(trace).targetMet).toBe(false);
  });
});
