/** 离线归因：当前段同步调用的墙钟时间，不等于 CPU 忙碌或 GPU 执行时间。 */
export function summarizeLandPhases(trace) {
  if (!trace.phases) return null;
  const { columns, values, frames, phases } = trace;
  const index = Object.fromEntries(columns.map((name, i) => [name, i]));
  const read = (row, name) => values[row * columns.length + index[name]];
  const metric = (numbers) => {
    if (!numbers.length) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    return {
      count: numbers.length,
      p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
      total: numbers.reduce((sum, n) => sum + n, 0),
    };
  };
  const measuredIds = new Set(trace.segments.filter((s) => s.kind === 'measured').map((s) => s.id));
  const measured = [],
    rowsByFrame = new Map(),
    issues = [];
  for (let row = 0; row < frames; row++) {
    const frame = read(row, 'phaseFrame');
    rowsByFrame.set(frame, row);
    if (
      read(row, 'phaseRafMs') !== read(row, 'rafMs') ||
      read(row, 'phaseValid') !== 1 ||
      (row > 0 && frame !== read(row - 1, 'phaseFrame') + 1)
    )
      issues.push({ row, reason: '帧身份/计时栈不连续' });
    const accounted = phases.names.reduce((sum, name) => sum + read(row, `${name}ExclusiveMs`), 0);
    if (
      !Number.isFinite(accounted) ||
      Math.abs(accounted + read(row, 'unattributedMs') - read(row, 'appMs')) > 0.000001 ||
      read(row, 'unattributedMs') < -0.000001
    )
      issues.push({ row, reason: '嵌套时间不守恒' });
    if (measuredIds.has(read(row, 'segment'))) measured.push(row);
  }
  const durations = Object.fromEntries(
    phases.names.map((name) => [
      name,
      {
        inclusive: metric(measured.map((row) => read(row, `${name}InclusiveMs`))),
        exclusive: metric(measured.map((row) => read(row, `${name}ExclusiveMs`))),
        calls: measured.reduce((sum, row) => sum + read(row, `${name}Calls`), 0),
      },
    ]),
  );
  const pairs = [];
  for (let row = 1; row < frames; row++) {
    if (
      (!measuredIds.has(read(row, 'segment')) && !measuredIds.has(read(row - 1, 'segment'))) ||
      read(row, 'deltaMs') <= 50.000001
    )
      continue;
    const previous = row - 1;
    const parts = Object.fromEntries(
      phases.names.map((name) => [name, read(previous, `${name}ExclusiveMs`)]),
    );
    parts.unattributed = read(previous, 'unattributedMs');
    const dominant = Object.keys(parts).reduce((a, b) => (parts[a] >= parts[b] ? a : b));
    pairs.push({
      row,
      sourceRow: previous,
      sourceFrame: read(previous, 'phaseFrame'),
      sourceSegment: read(previous, 'segment'),
      intervalSegment: read(row, 'segment'),
      intervalMs: read(row, 'deltaMs'),
      previousAppMs: read(previous, 'appMs'),
      gapToCurrentStartMs: read(row, 'appStartMs') - read(previous, 'appEndMs'),
      previousStartLagMs: read(previous, 'appStartMs') - read(previous, 'rafMs'),
      currentStartLagMs: read(row, 'appStartMs') - read(row, 'rafMs'),
      dominant,
      exclusiveMs: parts,
      calls: read(previous, 'calls'),
      shadow: read(previous, 'shadowMainCalls'),
      reflection: read(previous, 'reflectionRendered'),
      geometries: read(previous, 'geometries'),
      textures: read(previous, 'textures'),
      programs: read(previous, 'programs'),
    });
  }
  const gpu = [],
    lag = [];
  let unmatched = 0;
  for (let i = 0; i < phases.queryValues.length; i += 3) {
    const source = phases.queryValues[i],
      published = phases.queryValues[i + 1];
    const row = rowsByFrame.get(source);
    if (row === undefined) {
      unmatched++;
      continue;
    }
    if (published <= source) issues.push({ row, reason: 'GPU 结果发起/发布帧无效' });
    if (measuredIds.has(read(row, 'segment'))) {
      gpu.push(phases.queryValues[i + 2]);
      lag.push(published - source);
    }
  }
  if (
    phases.queryValues.length !== phases.queries * 3 ||
    phases.queryValues.some((n) => !Number.isFinite(n))
  )
    issues.push({ reason: 'GPU 原始表无效' });
  return {
    valid:
      trace.summary.valid &&
      !phases.queryOverflow &&
      phases.invalidFrames === 0 &&
      issues.length === 0 &&
      phases.cleanup.expected === phases.cleanup.restored,
    meaning:
      '分段 inclusive 含子段；仅 exclusive 可加总。同步调用墙钟包含潜在 GC/驱动等待/线程调度。长 RAF 关联前一实际应用帧，回调外间隙另列。',
    issues,
    measuredFrames: measured.length,
    durations,
    appMs: metric(measured.map((row) => read(row, 'appMs'))),
    unattributedMs: metric(measured.map((row) => read(row, 'unattributedMs'))),
    longIntervals: pairs.length,
    dominantCounts: Object.fromEntries(
      [...phases.names, 'unattributed'].map((name) => [
        name,
        pairs.filter((pair) => pair.dominant === name).length,
      ]),
    ),
    longest: pairs.sort((a, b) => b.intervalMs - a.intervalMs).slice(0, 12),
    pairedGpuMs: metric(gpu),
    gpuPublishLagFrames: metric(lag),
    unmatchedQueries: unmatched,
    cleanup: phases.cleanup,
  };
}
