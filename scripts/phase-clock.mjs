/** 有界同步调用栈。exclusive 扣掉所有已计时子段，避免把倒影/阴影重复算进主渲染。 */
export function createPhaseClock({ names, depthLimit = 32, install = false }) {
  const inclusive = new Float64Array(names.length);
  const exclusive = new Float64Array(names.length);
  const calls = new Uint32Array(names.length);
  const active = new Uint16Array(names.length);
  const ids = new Uint16Array(depthLimit);
  const starts = new Float64Array(depthLimit);
  const children = new Float64Array(depthLimit);
  let depth = 0,
    invalid = false;
  const clock = {
    inclusive,
    exclusive,
    calls,
    active,
    get valid() {
      return !invalid && depth === 0;
    },
    reset() {
      inclusive.fill(0);
      exclusive.fill(0);
      calls.fill(0);
      active.fill(0);
      depth = 0;
      invalid = false;
    },
    enter(id, now) {
      if (depth >= depthLimit || id < 0 || id >= names.length) {
        invalid = true;
        depth++;
        return;
      }
      ids[depth] = id;
      starts[depth] = now;
      children[depth] = 0;
      calls[id]++;
      active[id]++;
      depth++;
    },
    leave(now) {
      if (depth <= 0) {
        invalid = true;
        return;
      }
      depth--;
      if (depth >= depthLimit) return;
      const id = ids[depth],
        duration = now - starts[depth];
      const own = duration - children[depth];
      if (duration < 0 || own < -0.000001) invalid = true;
      inclusive[id] += duration;
      exclusive[id] += own;
      active[id]--;
      if (depth > 0) children[depth - 1] += duration;
    },
  };
  // Playwright 可直接序列化此纯函数，无需 eval 或加载任何运行时脚本资源。
  if (install) {
    globalThis.__landPhaseClock = clock;
    return { names, depthLimit };
  }
  return clock;
}
