/** 原始 RAF 间隔与异步 GPU 发布值有不同含义；分位数不得按行相减。 */
export function summarizeLightingTrace(trace) {
  // 只消除时间戳相减的二进制尾差；0.000001ms 远小于浏览器 0.1ms 量化精度。
  const epsilonMs = 0.000001;
  const { columns, values, segments } = trace;
  if (values.length !== trace.frames * columns.length || values.some((n) => !Number.isFinite(n)))
    throw new Error('逐帧表长度或数值无效，不能作性能结论');
  const index = Object.fromEntries(columns.map((name, i) => [name, i]));
  const read = (row, name) => values[row * columns.length + index[name]];
  const metric = (samples, duration = true) => {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
      ...(duration
        ? {
            over33ms: samples.filter((n) => n > 1000 / 30 + epsilonMs).length,
            over50ms: samples.filter((n) => n > 50 + epsilonMs).length,
          }
        : {}),
    };
  };
  const overlaps = (entry, segment) =>
    entry.startTime < segment.endMs && entry.startTime + entry.duration > segment.startMs;
  const results = segments
    .filter((segment) => segment.to || segment.kind === 'interrupt-settle')
    .map((segment) => {
      const samples = [],
        interior = [],
        boundary = [],
        cpu = [],
        calls = [],
        triangles = [],
        overhead = [];
      const reflection = { updated: [], cached: [] };
      let invalidFrames = 0,
        boundaryFrames = 0;
      for (let row = segment.startRow; row < (segment.endRow ?? trace.frames); row++) {
        if (read(row, 'segment') !== segment.id) continue;
        if (read(row, 'activityMask') || read(row, 'appFrames') !== 1) invalidFrames++;
        // 边界间隔可能同时包含请求前后的时间。单列用于归因，严格验收仍计入它，不能隐藏慢首帧。
        const delta = read(row, 'deltaMs');
        if (read(row, 'rafMs') - delta < segment.startMs) {
          boundaryFrames++;
          boundary.push(delta);
        } else interior.push(delta);
        samples.push(delta);
        cpu.push(read(row, 'pipelineCpuMs'));
        calls.push(read(row, 'calls'));
        triangles.push(read(row, 'triangles'));
        overhead.push(read(row, 'probeMs'));
        reflection[read(row, 'reflectionRendered') ? 'updated' : 'cached'].push(
          read(row, 'pipelineCpuMs'),
        );
      }
      const longTasks = trace.entries.filter(
        (e) => e.entryType === 'longtask' && overlaps(e, segment),
      );
      const longFrames = trace.entries.filter(
        (e) => e.entryType === 'long-animation-frame' && overlaps(e, segment),
      );
      // 最后一帧绘制可能拖慢下一段的首个 RAF；原窗口另存，验收必须覆盖该尾间隔。
      const tailRow = segment.endRow;
      const trailingCovered =
        Number.isInteger(tailRow) && tailRow > segment.startRow && tailRow < trace.frames;
      const tail = trailingCovered ? [read(tailRow, 'deltaMs')] : [];
      if (trailingCovered && (read(tailRow, 'activityMask') || read(tailRow, 'appFrames') !== 1))
        invalidFrames++;
      return {
        id: segment.id,
        kind: segment.kind,
        round: segment.round,
        to: segment.to,
        startMs: segment.startMs,
        endMs: segment.endMs,
        requestMs: segment.requestMs,
        continuous: segment.continuous,
        boundaryFrames,
        invalidFrames,
        frameMs: metric(samples),
        trailingCovered,
        trailingFrameMs: metric(tail),
        acceptanceFrameMs: metric([...samples, ...tail]),
        interiorFrameMs: metric(interior),
        boundaryFrameMs: metric(boundary),
        pipelineCpuMs: metric(cpu),
        calls: metric(calls, false),
        triangles: metric(triangles, false),
        probeMs: metric(overhead),
        reflectionCpuMs: { updated: metric(reflection.updated), cached: metric(reflection.cached) },
        longTasks: longTasks.length,
        longFrames: longFrames.length,
        shadowRequests: segment.after
          ? segment.after.shadowRequests - segment.before.shadowRequests
          : null,
        reflectionUpdates: segment.after
          ? segment.after.reflectionUpdates - segment.before.reflectionUpdates
          : null,
      };
    });
  const measured = results.filter((s) => s.kind === 'measured');
  const valid =
    !trace.failure &&
    !trace.entryOverflow &&
    (trace.activity ?? []).every((event) => event.mask === 0) &&
    measured.length > 0 &&
    results.every(
      (s) => s.endMs !== undefined && s.invalidFrames === 0 && s.continuous !== false,
    ) &&
    measured.every((s) => s.frameMs !== null && s.interiorFrameMs !== null);
  return {
    valid,
    failure: trace.failure,
    viewIndex: trace.viewIndex,
    detailed: trace.detailed,
    gpuMeaning: '异步发布值，未逐帧配对，不作为当前 RAF 的 GPU 时长',
    timingMeaning:
      'deltaMs 为相邻 RAF 时间戳之差；CPU/calls 为当前已完成绘制，影响下一 RAF 间隔；observedAtMs 是采样实际墙钟，不能直接按行将 CPU 与间隔相减',
    segments: results,
    targetMet:
      valid &&
      measured.every(
        (s) =>
          s.trailingCovered &&
          s.acceptanceFrameMs.p95 <= 16.7 + epsilonMs &&
          s.acceptanceFrameMs.over50ms === 0,
      ),
  };
}
