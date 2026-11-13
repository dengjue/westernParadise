import { describe, expect, it } from 'vitest';
import { createSoakTimeline, summarizeSoakSegment } from './land-soak-timeline.mjs';

describe('连续长测证据', () => {
  it('首个 RAF 只作起点，分段导出期间的慢帧归入下一段且总时长守恒', () => {
    const timeline = createSoakTimeline({ capacity: 8 });
    timeline.append(100, 1);
    timeline.append(116.7, 1, 5);
    timeline.append(133.4, 1, 6);
    const first = timeline.take();
    timeline.append(333.4, 1, 7);
    timeline.append(350.1, 1, 5);
    const second = timeline.take();
    expect(first.frames).toBe(2);
    expect(first.endMs).toBe(second.startMs);
    expect(first.elapsedMs + second.elapsedMs).toBeCloseTo(250.1);
    expect(summarizeSoakSegment(first).frameMs.over50ms).toBe(0);
    expect(summarizeSoakSegment(second).frameMs.max).toBeCloseTo(200);
    expect(summarizeSoakSegment(second).frameMs.over50ms).toBe(1);
  });
  it('秒级异常保留真实值，50ms 二进制尾差不算超标，漏绘制/失焦明确无效', () => {
    const timeline = createSoakTimeline({ capacity: 8 });
    timeline.append(0, 1);
    timeline.append(50.00000000001, 1, 5);
    timeline.append(3474.9, 1, 3200);
    const good = summarizeSoakSegment(timeline.take());
    expect(good.valid).toBe(true);
    expect(good.frameMs.p95).toBeCloseTo(3424.9);
    expect(good.frameMs.over50ms).toBe(1);
    timeline.append(3491.6, 0);
    timeline.append(3508.3, 1, 5, 1, 1, 0, 0, 2);
    const bad = summarizeSoakSegment(timeline.take());
    expect(bad.invalidFrames).toBe(2);
    expect(bad.valid).toBe(false);
  });
  it('边界篡改、活动事件和未完成错误不能冒充有效段', () => {
    const timeline = createSoakTimeline({ capacity: 8 });
    timeline.append(1, 1);
    timeline.append(17, 1);
    const segment = timeline.take();
    expect(() => summarizeSoakSegment({ ...segment, startMs: 2 })).toThrow('不连续');
    expect(() => summarizeSoakSegment({ ...segment, endMs: 18 })).toThrow('不守恒');
    expect(summarizeSoakSegment({ ...segment, activity: [{ mask: 2 }] }).valid).toBe(false);
    expect(summarizeSoakSegment({ ...segment, failure: '超时' }).valid).toBe(false);
    expect(() => summarizeSoakSegment({ ...segment, startMs: NaN })).toThrow('边界缺失');
    expect(() =>
      summarizeSoakSegment({
        ...segment,
        columns: segment.columns.map((name) => (name === 'deltaMs' ? 'missing' : name)),
      }),
    ).toThrow('列');
  });
  it('时间倒退和容量溢出停止写入，已有数据仍可导出', () => {
    const timeline = createSoakTimeline({ capacity: 2 });
    timeline.append(0, 1);
    timeline.append(16, 1);
    timeline.append(32, 1);
    expect(() => timeline.append(20, 1)).toThrow('倒退');
    expect(() => timeline.append(48, 1)).toThrow('容量');
    expect(summarizeSoakSegment(timeline.take()).frameMs.count).toBe(2);
    timeline.append(48, 1);
    expect(summarizeSoakSegment(timeline.take()).frameMs.max).toBe(16);
  });
});
