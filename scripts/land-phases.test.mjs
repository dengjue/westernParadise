import { describe, expect, it } from 'vitest';
import { createPhaseClock } from './phase-clock.mjs';
import { summarizeLandPhases } from './summarize-land-phases.mjs';

describe('分段计时的嵌套与证据对应', () => {
  it('阴影/倒影不重复计入主渲染，父子及总时间守恒', () => {
    const clock = createPhaseClock({ names: ['main', 'shadow', 'reflection'] });
    clock.enter(0, 0);
    clock.enter(1, 2);
    clock.leave(5);
    clock.enter(2, 6);
    clock.enter(1, 8);
    clock.leave(9);
    clock.leave(10);
    clock.leave(12);
    expect([...clock.inclusive]).toEqual([12, 4, 4]);
    expect([...clock.exclusive]).toEqual([5, 4, 3]);
    expect([...clock.calls]).toEqual([1, 2, 1]);
    expect(clock.valid).toBe(true);
  });
  it('递归同名段、异常 finally 出栈与后续重置均保持守恒', () => {
    const clock = createPhaseClock({ names: ['draw'] });
    clock.enter(0, 0);
    clock.enter(0, 2);
    try {
      throw new Error('模拟绘制异常');
    } catch {
      /* 包装器的 finally 仍必须计时 */
    } finally {
      clock.leave(4);
      clock.leave(6);
    }
    expect(clock.inclusive[0]).toBe(8);
    expect(clock.exclusive[0]).toBe(6);
    expect(clock.valid).toBe(true);
    clock.reset();
    expect(clock.calls[0]).toBe(0);
    expect(clock.active[0]).toBe(0);
  });
  it('栈溢出或时钟倒退留为无效，下一帧可恢复', () => {
    const clock = createPhaseClock({ names: ['draw'], depthLimit: 1 });
    clock.enter(0, 0);
    clock.enter(0, 1);
    clock.leave(2);
    clock.leave(3);
    expect(clock.valid).toBe(false);
    clock.reset();
    clock.enter(0, 5);
    clock.leave(4);
    expect(clock.valid).toBe(false);
    clock.reset();
    clock.enter(0, 0);
    clock.leave(2);
    expect(clock.valid).toBe(true);
  });
  function traceFixture() {
    const columns = [
      'rafMs',
      'deltaMs',
      'segment',
      'phaseFrame',
      'phaseRafMs',
      'phaseValid',
      'appStartMs',
      'appEndMs',
      'appMs',
      'unattributedMs',
      'drawInclusiveMs',
      'drawExclusiveMs',
      'drawCalls',
      'calls',
      'shadowMainCalls',
      'reflectionRendered',
      'geometries',
      'textures',
      'programs',
    ];
    const row = (raf, delta, frame, start, end) => [
      raf,
      delta,
      0,
      frame,
      raf,
      1,
      start,
      end,
      end - start,
      1,
      end - start - 1,
      end - start - 1,
      1,
      10,
      0,
      0,
      5,
      4,
      3,
    ];
    return {
      columns,
      values: [...row(100, 10, 10, 101, 160), ...row(170, 70, 11, 172, 175)],
      frames: 2,
      segments: [{ id: 0, kind: 'measured' }],
      summary: { valid: true },
      phases: {
        names: ['draw'],
        invalidFrames: 0,
        queryOverflow: false,
        cleanup: { expected: 3, restored: 3 },
        queries: 2,
        queryValues: [10, 12, 8, 9, 11, 9],
      },
    };
  }
  it('长间隔对应前一绘制，GPU 按发起帧配对而非发布行', () => {
    const result = summarizeLandPhases(traceFixture());
    expect(result.valid).toBe(true);
    expect(result.longest[0]).toMatchObject({
      row: 1,
      sourceRow: 0,
      sourceFrame: 10,
      intervalMs: 70,
      previousAppMs: 59,
      gapToCurrentStartMs: 12,
      dominant: 'draw',
    });
    expect(result.pairedGpuMs.max).toBe(8);
    expect(result.unmatchedQueries).toBe(1);
  });
  it('同帧身份不符、坏表或未恢复包装不能通过', () => {
    const wrong = traceFixture();
    wrong.values[4] = 99;
    expect(summarizeLandPhases(wrong).valid).toBe(false);
    const bad = traceFixture();
    bad.phases.queryValues.pop();
    expect(summarizeLandPhases(bad).valid).toBe(false);
    const leaked = traceFixture();
    leaked.phases.cleanup.restored = 2;
    expect(summarizeLandPhases(leaked).valid).toBe(false);
  });
  it('跨出过渡窗口的长 RAF 仍关联最后一次过渡绘制', () => {
    const trace = traceFixture();
    trace.values[trace.columns.length + trace.columns.indexOf('segment')] = 1;
    expect(summarizeLandPhases(trace).longest[0]).toMatchObject({
      sourceSegment: 0,
      intervalSegment: 1,
    });
  });
});
