const SAMPLE_MS = 10_000;

/** 测试服可选读数：在实际提交画面后传入时间，不用逻辑步数代替帧数。 */
export function mountLandFrameCheck(parent: HTMLElement, quality: string) {
  const panel = document.createElement('output');
  panel.className = 'land-frame-check';
  panel.style.cssText =
    'position:fixed;top:18%;left:50%;transform:translateX(-50%);z-index:10;pointer-events:none;background:#142323e8;color:white;padding:.35em .7em;font:12px/1.4 system-ui;text-align:center;white-space:pre';
  parent.append(panel);
  let last = NaN,
    start = 0,
    count = -1,
    airborne = false,
    width = 0,
    height = 0;
  const intervals: number[] = [];
  function reset() {
    last = NaN;
    intervals.length = 0;
    panel.textContent = '帧率采样 · 等待前台联机游历';
  }
  reset();
  return {
    reset,
    frame(now: number, neighbors: number, flying: boolean, w: number, h: number) {
      // 切换状态、邻居数或动态分辨率后重新开窗，避免把不同负载混为一组。
      if (
        !Number.isFinite(last) ||
        count !== neighbors ||
        airborne !== flying ||
        width !== w ||
        height !== h
      ) {
        count = neighbors;
        airborne = flying;
        width = w;
        height = h;
        intervals.length = 0;
        start = last = now;
        panel.textContent = `${flying ? '飞行' : '步行'} · 附近 ${count} 人 · 正在采样 10 秒`;
        return;
      }
      intervals.push(now - last);
      last = now;
      if (now - start < SAMPLE_MS) return;
      const fps = (1000 * intervals.length) / (now - start);
      intervals.sort((a, b) => a - b);
      const p95 = intervals[Math.ceil(intervals.length * 0.95) - 1]!;
      panel.textContent = `${flying ? '飞行' : '步行'} · 附近 ${count} 人 · ${quality} · ${w}×${h}\n${fps.toFixed(1)} FPS · P95 ${p95.toFixed(1)} ms`;
      intervals.length = 0;
      start = now;
    },
    dispose() {
      panel.remove();
    },
  };
}
