/** 生产文件 ?bench 页面的渲染回归：真实帧驱动，不依赖固定 sleep 或 GPU 同步等待。 */
export async function verifyLandRender(page) {
  await page.waitForFunction(() => window.__G?.world.reflection.stats.updates > 0);
  return page.evaluate(async () => {
    const g = window.__G,
      { world, landCamera, events, renderer, scene } = g;
    const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    events.emit('land:tour', { enabled: false });
    const previousIndex = landCamera.index;
    const resources = () => ({ ...renderer.info.memory, programs: renderer.info.programs.length });
    const motion = [],
      cycles = [];
    try {
      landCamera.selectView(3, true);
      await next();
      // 两套视锥各自选级，快速切换的下一绘制帧就必须更新倒影。
      for (let index = 0; index < 24; index++) {
        const before = world.reflection.stats.updates;
        landCamera.selectView(index % 4, true);
        await next();
        const stats = { ...world.reflection.stats };
        check(stats.updates > before, `快速切换 ${index} 未即时更新倒影`);
        motion.push({ view: index % 4, calls: stats.calls, triangles: stats.triangles });
      }
      for (const to of ['dawn', 'noon', 'dusk']) {
        const before = world.reflection.stats.updates;
        events.emit('tod:request', { to });
        await next();
        check(world.reflection.stats.updates > before, `${to} 未失效倒影`);
      }
      // 相同布局循环走完后，不应继续新增几何、纹理或 shader program。
      for (let cycle = 0; cycle < 4; cycle++) {
        for (let index = 0; index < 4; index++) {
          landCamera.selectView(index, true);
          events.emit('tod:request', { to: ['dawn', 'noon', 'dusk'][index % 3] });
          for (let frame = 0; frame < 6; frame++) await next();
        }
        cycles.push(resources());
      }
      check(
        cycles.every((value) => JSON.stringify(value) === JSON.stringify(cycles[0])),
        '循环资源未回稳',
      );
      landCamera.selectView(1, true);
      for (let frame = 0; frame < 60; frame++) await next();
      let updated = 0,
        cached = 0;
      const start = performance.now();
      for (let frame = 0; frame < 180; frame++) {
        await next();
        if (world.reflection.stats.rendered) updated++;
        else cached++;
      }
      check(updated > 0 && cached > 0, '普通静止视角应同时存在更新帧和缓存帧');
      const lodStates = [];
      scene.traverse((object) => {
        if (object.isLOD) lodStates.push([...object.selected]);
      });
      check(
        lodStates.some(([main, reflection]) => main !== reflection),
        '倒影未独立选择细节',
      );
      check(!window.__fatal, `致命错误：${window.__fatal}`);
      return {
        motion,
        cycles,
        stationary: { updated, cached, measuredHz: (updated * 1000) / (performance.now() - start) },
        lodCount: lodStates.length,
        cameraIndependent: true,
        budget: g.renderBudget.pipeline,
      };
    } finally {
      landCamera.selectView(previousIndex, true);
      events.emit('tod:request', { to: new URLSearchParams(location.search).get('tod') || 'dawn' });
    }
  });
}

/** 同一文档连续四次真实挂载/释放，跟踪 window/document 长生命周期监听器。 */
export async function verifyLandLifecycle(page) {
  await page.waitForFunction(() => typeof window.__G?.restart === 'function');
  return page.evaluate(async () => {
    const add = EventTarget.prototype.addEventListener,
      remove = EventTarget.prototype.removeEventListener;
    const registrations = new Map();
    function track(target, type) {
      if (target !== window && target !== document) return null;
      const key = (target === window ? 'window:' : 'document:') + type;
      if (!registrations.has(key)) registrations.set(key, new Set());
      return registrations.get(key);
    }
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      track(this, type)?.add(listener);
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      track(this, type)?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const snapshot = (g) => ({
      memory: { ...g.renderer.info.memory },
      canvases: document.querySelectorAll('canvas').length,
      listeners: [...registrations.values()].reduce((sum, set) => sum + set.size, 0),
    });
    const results = [];
    try {
      for (let cycle = 0; cycle < 4; cycle++) {
        window.__G.restart();
        for (let frame = 0; frame < 30; frame++) await next();
        const g = window.__G,
          active = snapshot(g);
        g.dispose();
        g.dispose();
        await next();
        const released = { ...snapshot(g), contextLost: g.renderer.getContext().isContextLost() };
        if (
          released.memory.geometries ||
          released.memory.textures ||
          released.canvases ||
          released.listeners
        )
          throw new Error(`第 ${cycle} 次释放未归零：${JSON.stringify(released)}`);
        results.push({ cycle, active, released });
      }
      if (!results.every((row) => JSON.stringify(row.active) === JSON.stringify(results[0].active)))
        throw new Error('重复挂载的资源或监听器持续增长');
      return results;
    } finally {
      EventTarget.prototype.addEventListener = add;
      EventTarget.prototype.removeEventListener = remove;
      window.__G.restart();
    }
  });
}
