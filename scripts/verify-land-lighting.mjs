/** Phase 5 真实帧驱动光阴回归。普通动效 ?bench 页面；返回切换成本而不作固定 FPS 承诺。 */
export async function verifyLandLighting(page) {
  await page.waitForFunction(
    () => window.__G?.world.lighting && window.__G.world.reflection.stats.updates > 2,
  );
  return page.evaluate(async () => {
    const g = window.__G,
      { world, events, renderer, scene } = g;
    const transition = world.lighting.transition;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches)
      throw new Error('此脚本需要普通动效');
    const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const settle = async () => {
      const deadline = performance.now() + 15000;
      while (transition.active) {
        check(performance.now() < deadline, '光阴过渡未结束');
        await next();
      }
      await next();
    };
    const summarize = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        count: sorted.length,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        max: sorted.at(-1),
      };
    };
    const resources = () => ({ ...renderer.info.memory, programs: renderer.info.programs.length });
    const original = transition.target,
      originalView = g.landCamera.index;
    events.emit('land:tour', { enabled: false });
    g.landCamera.selectView(0, true);
    events.emit('tod:request', { to: 'dawn' });
    await settle();
    const environment = scene.environment,
      before = resources(),
      samples = [],
      cycles = [];
    try {
      for (const to of ['noon', 'dusk', 'dawn']) {
        const intervals = [],
          cpu = [],
          gpu = [],
          calls = [],
          triangles = [];
        let gpuCount = g.renderBudget.telemetry.gpuSamples;
        const remove = events.on('app:frame', ({ deltaMs }) => {
          intervals.push(deltaMs);
          cpu.push(g.renderBudget.telemetry.cpuMs);
          calls.push(renderer.info.render.calls);
          triangles.push(renderer.info.render.triangles);
          if (
            g.renderBudget.telemetry.gpuSamples > gpuCount &&
            g.renderBudget.telemetry.gpuMs !== null
          ) {
            gpu.push(g.renderBudget.telemetry.gpuMs);
            gpuCount = g.renderBudget.telemetry.gpuSamples;
          }
        });
        const shadow = world.lighting.shadowRequests,
          reflection = world.reflection.stats.updates;
        const start = performance.now();
        events.emit('tod:request', { to });
        const requestMs = performance.now() - start;
        try {
          await settle();
        } finally {
          remove();
        }
        check(
          scene.environment === environment && world.lighting.environment.bakes === 3,
          '切换重新创建了环境图',
        );
        check(transition.weights[['dawn', 'noon', 'dusk'].indexOf(to)] === 1, '过渡未精确到达终点');
        check(world.reflection.stats.updates > reflection, '光阴过渡未刷新倒影');
        const elapsedMs = performance.now() - start;
        check(
          world.reflection.stats.updates - reflection <=
            Math.ceil((elapsedMs / 1000) * world.reflection.stats.intervalHz) + 3,
          '光阴过渡绕过了静止相机的反射频率预算',
        );
        samples.push({
          to,
          requestMs,
          elapsedMs,
          frameMs: summarize(intervals),
          cpuMs: summarize(cpu),
          gpuMs: summarize(gpu),
          calls: summarize(calls),
          triangles: summarize(triangles),
          shadowRequests: world.lighting.shadowRequests - shadow,
          reflectionUpdates: world.reflection.stats.updates - reflection,
        });
        cycles.push(resources());
      }
      // 每次中断都在同一 JS 任务内比较请求前后权重，捕捉跳回旧预设的错误。
      let interrupts = 0;
      for (const to of ['noon', 'dusk', 'dawn', 'noon', 'dusk', 'noon']) {
        const weights = Array.from(transition.weights);
        events.emit('tod:request', { to });
        check(
          weights.every((value, index) => value === transition.weights[index]),
          '中断时颜色权重跳变',
        );
        for (let frame = 0; frame < 15; frame++) await next();
        check(
          Math.abs(transition.weights.reduce((sum, value) => sum + value, 0) - 1) < 0.000001,
          '混合权重不守恒',
        );
        interrupts++;
      }
      await settle();
      const final = resources();
      // 初次阴影视锥改变可能上传此前未见的几何；完整三时段预热后必须回稳。
      check(JSON.stringify(final) === JSON.stringify(cycles.at(-1)), '切换导致资源或程序持续增长');
      check(!window.__fatal, '运行时致命错误');
      return {
        samples,
        interrupts,
        before,
        cycles,
        final,
        environment: world.lighting.environment,
      };
    } finally {
      events.emit('tod:request', { to: original });
      await settle();
      g.landCamera.selectView(originalView, true);
    }
  });
}
