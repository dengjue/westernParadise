/** 连续 RAF 轴：分段导出保留上一时间戳，不能漏掉导出期间或段边界的慢帧。 */
export function createSoakTimeline({ capacity = 24000, install = false } = {}) {
  if (!Number.isInteger(capacity) || capacity < 2) throw new RangeError('逐段容量必须至少为 2');
  const columns = [
    'rafMs',
    'deltaMs',
    'appFrames',
    'pipelineCpuMs',
    'calls',
    'triangles',
    'reflectionRendered',
    'shadowRequests',
    'activityMask',
    'view',
    'timeMode',
    'transitionActive',
  ];
  let values = new Float64Array(capacity * columns.length),
    count = 0,
    previous = null,
    start = null;
  const timeline = {
    get frames() {
      return count;
    },
    get elapsedMs() {
      return previous === null ? 0 : previous - start;
    },
    append(
      now,
      appFrames,
      cpuMs = 0,
      calls = 0,
      triangles = 0,
      reflection = 0,
      shadows = 0,
      mask = 0,
      view = 0,
      timeMode = 0,
      transitionActive = 0,
    ) {
      if (!Number.isFinite(now) || (previous !== null && now <= previous))
        throw new Error('RAF 时间戳无效或倒退');
      if (previous === null) {
        previous = start = now;
        return;
      }
      if (count === capacity) throw new Error('连续长测逐段容量耗尽');
      const offset = count * columns.length;
      values[offset] = now;
      values[offset + 1] = now - previous;
      values[offset + 2] = appFrames;
      values[offset + 3] = cpuMs;
      values[offset + 4] = calls;
      values[offset + 5] = triangles;
      values[offset + 6] = reflection;
      values[offset + 7] = shadows;
      values[offset + 8] = mask;
      values[offset + 9] = view;
      values[offset + 10] = timeMode;
      values[offset + 11] = transitionActive;
      previous = now;
      count++;
    },
    take() {
      const result = {
        columns,
        startMs: start,
        endMs: previous,
        elapsedMs: timeline.elapsedMs,
        frames: count,
        values: values.subarray(0, count * columns.length),
      };
      // 每 150 秒才切换缓冲；每帧只有数值写入。上段导出后，下段首帧仍接续上段末帧。
      values = new Float64Array(capacity * columns.length);
      start = previous;
      count = 0;
      return result;
    },
  };
  if (install) {
    globalThis.__landSoakTimeline = timeline;
    return { columns, capacity };
  }
  return timeline;
}

/** 完整原始间隔上的精确分位数；不使用会截断秒级异常的直方图上限。 */
export function summarizeSoakSegment(segment) {
  const { columns, values, frames } = segment;
  if (
    !Number.isInteger(frames) ||
    frames < 1 ||
    !Array.isArray(columns) ||
    new Set(columns).size !== columns.length ||
    values.length !== frames * columns.length ||
    values.some((n) => !Number.isFinite(n))
  )
    throw new Error('长测逐帧表无效或为空');
  const index = Object.fromEntries(columns.map((name, i) => [name, i]));
  if (
    [
      'rafMs',
      'deltaMs',
      'appFrames',
      'pipelineCpuMs',
      'activityMask',
      'view',
      'timeMode',
      'transitionActive',
    ].some((name) => index[name] === undefined) ||
    ![segment.startMs, segment.endMs, segment.elapsedMs].every(Number.isFinite)
  )
    throw new Error('长测列或段边界缺失');
  const deltas = [],
    cpu = [];
  const coverage = { views: [0, 0, 0, 0], timeModes: [0, 0, 0], transitioning: 0 };
  let previous = segment.startMs,
    invalidFrames = 0;
  for (let row = 0; row < frames; row++) {
    const read = (name) => values[row * columns.length + index[name]],
      delta = read('deltaMs');
    if (delta <= 0 || Math.abs(read('rafMs') - previous - delta) > 0.000001)
      throw new Error('长测时间轴不连续');
    previous = read('rafMs');
    if (read('activityMask') || read('appFrames') !== 1) invalidFrames++;
    const view = read('view'),
      mode = read('timeMode'),
      transition = read('transitionActive');
    if (
      !Number.isInteger(view) ||
      view < 0 ||
      view > 3 ||
      !Number.isInteger(mode) ||
      mode < 0 ||
      mode > 2 ||
      ![0, 1].includes(transition) ||
      read('pipelineCpuMs') < 0
    )
      throw new Error('长测负载列无效');
    coverage.views[view]++;
    coverage.timeModes[mode]++;
    coverage.transitioning += transition;
    deltas.push(delta);
    cpu.push(read('pipelineCpuMs'));
  }
  if (
    previous !== segment.endMs ||
    Math.abs(previous - segment.startMs - segment.elapsedMs) > 0.000001
  )
    throw new Error('长测段边界不守恒');
  const summarize = (samples) => {
    samples.sort((a, b) => a - b);
    return {
      count: samples.length,
      p50: samples[Math.ceil(samples.length * 0.5) - 1],
      p95: samples[Math.ceil(samples.length * 0.95) - 1],
      max: samples.at(-1),
      over33ms: samples.filter((n) => n > 1000 / 30 + 0.000001).length,
      over50ms: samples.filter((n) => n > 50 + 0.000001).length,
    };
  };
  return {
    valid: !segment.failure && invalidFrames === 0 && !segment.activity?.some((e) => e.mask),
    invalidFrames,
    coverage,
    frameMs: summarize(deltas),
    pipelineCpuMs: summarize(cpu),
  };
}
