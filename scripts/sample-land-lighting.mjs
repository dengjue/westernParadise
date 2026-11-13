import { installLandFrameRecorder } from './record-land-frames.mjs';
import { summarizeLightingTrace } from './summarize-lighting-trace.mjs';

/** 一个景点包含首次/预热循环、三组完整切换和可选中断；返回原始时间线及聚合。 */
export async function sampleLandLighting(
  page,
  { viewIndex = 0, rounds = 3, detailed = true, firstUse = false, interruptions = true } = {},
) {
  if (
    !Number.isInteger(viewIndex) ||
    viewIndex < 0 ||
    viewIndex > 3 ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 5
  )
    throw new RangeError('景点需为 0–3，重复轮次需为 1–5');
  await page.waitForFunction(() => window.__G?.startup.firstFrameMs > 0);
  const original = await page.evaluate((view) => {
    const g = window.__G;
    if (
      document.hidden ||
      !document.hasFocus() ||
      g.landCamera.isWalking ||
      g.landCamera.modal ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      throw new Error('需要可见、聚焦、普通动效且未步行的诊断页');
    const saved = {
      view: g.landCamera.index,
      to: g.world.lighting.transition.target,
      touring: g.landCamera.touring,
    };
    g.events.emit('land:tour', { enabled: false });
    g.landCamera.selectView(view, true);
    return saved;
  }, viewIndex);
  const plan = [
    { kind: 'prepare', to: 'dawn' },
    { kind: 'settle', frames: 60 },
  ];
  for (let round = 0; round <= rounds; round++) {
    for (const to of ['noon', 'dusk', 'dawn']) {
      plan.push({
        kind: round === 0 ? (firstUse ? 'first-use' : 'warmup') : 'measured',
        round,
        to,
      });
      plan.push({ kind: 'settle', round, frames: 30 });
    }
  }
  if (interruptions) {
    for (const to of ['noon', 'dusk', 'dawn', 'noon', 'dusk', 'noon'])
      plan.push({ kind: 'interrupt', to, frames: 15 });
    plan.push({ kind: 'interrupt-settle' });
  }
  let trace;
  try {
    await installLandFrameRecorder(page, { detailed });
    trace = await page.evaluate(async (plan) => {
      const recorder = window.__landFrames;
      try {
        for (const step of plan) await recorder.measure(step);
        return recorder.finish();
      } catch (error) {
        return recorder.finish(error.message);
      }
    }, plan);
    trace.viewIndex = viewIndex;
    trace.summary = summarizeLightingTrace(trace);
    return trace;
  } finally {
    await page.evaluate((saved) => {
      window.__landFrames?.finish('驱动异常退出');
      const g = window.__G;
      g.events.emit('tod:request', { to: saved.to });
      g.landCamera.selectView(saved.view, true);
      g.events.emit('land:tour', { enabled: saved.touring });
    }, original);
  }
}
