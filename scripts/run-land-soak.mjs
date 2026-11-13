/** Tabbit 可见桌面长测。先获取浏览器已有预览的 tab ID：node scripts/run-land-soak.mjs <tab-id> */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tab = process.argv[2];
if (!/^\d+$/.test(tab ?? ''))
  throw new Error('用法：node scripts/run-land-soak.mjs <已观察到的 tab-id>');
const base = resolve('.'),
  directory = join(base, 'reports');
const launcher = join(homedir(), '.local/bin/tabbit-cli');
const artifact = await readFile(join(base, 'dist/single/index.html'));
const sha256 = createHash('sha256').update(artifact).digest('hex');
const started = new Date().toISOString(),
  run = Date.now().toString();
const url =
  pathToFileURL(join(base, 'dist/single/index.html')).href + '?q=high&bench&tod=dawn&seed=20261113';
const helper = pathToFileURL(join(base, 'scripts/soak-pure-land.mjs')).href;
const report = {
  started,
  artifact: { bytes: artifact.length, sha256 },
  device: { cpu: cpus()[0]?.model, memoryBytes: totalmem() },
  segments: [],
};
await mkdir(directory, { recursive: true });
async function invoke(suffix, code) {
  const id = `p6-soak-${run}-${suffix}`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(launcher, [
      'nodejs',
      '--task',
      'Phase6游历验收',
      '--tab',
      tab,
      '--request-id',
      id,
      '--timeout-ms',
      '180000',
    ]);
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exit) => resolve({ exit, stdout, stderr }));
    child.stdin.end(code);
  });
  await writeFile(join(directory, `${id}.receipt.json`), JSON.stringify(result, null, 2));
  const receipt = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .at(-1);
  if (result.exit !== 0 || receipt?.status !== 'succeeded' || !receipt.result?.value)
    throw new Error(`长测请求未成功，检查 ${id}.receipt.json；不要重复已执行段。`);
  return receipt.result.value;
}
try {
  report.setup = await invoke(
    'setup',
    `
    await page.emulateMedia({reducedMotion:'no-preference'});
    const cdp=await context.newCDPSession(page);
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1601,height:997,deviceScaleFactor:2,mobile:false});
      await page.goto(${JSON.stringify(url)},{waitUntil:'load'});
      await page.waitForFunction(()=>window.__G?.startup.firstFrameMs>0&&!window.__G.landCamera.suspended);
      await page.evaluate(async()=>{
        for(let view=0;view<4;view++) {
          window.__G.landCamera.selectView(view,true);
          window.__G.events.emit('tod:request',{to:['dawn','noon','dusk','dawn'][view]});
          do { await new Promise(r=>requestAnimationFrame(r)); } while(window.__G.world.lighting.transition.active);
        }
        window.__G.landCamera.selectView(0,true);
      });
      await page.getByRole('button',{name:'开启环境音',exact:true}).click();
      await page.waitForFunction(()=>window.__G.audio.context?.state==='running');
      return await page.evaluate(()=>({userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight,devicePixelRatio],renderRatio:window.__G.renderer.getPixelRatio(),audio:window.__G.audio.context.state,visible:!document.hidden,focused:document.hasFocus(),seed:window.__G.seed}));
    } finally { await cdp.detach(); }
  `,
  );
  for (let index = 0; index < 12; index++) {
    const segment = await invoke(
      `segment-${index + 1}`,
      `
      const errors=[];
      const error=e=>errors.push(e.message),consoleError=m=>{if(m.type()==='error')errors.push(m.text())};
      page.on('pageerror',error);page.on('console',consoleError);
      try {
        const {soakPureLand}=await import(${JSON.stringify(helper)});
        const sample=await soakPureLand(page,150000);
        return {index:${index + 1},startedAt:new Date(Date.now()-sample.elapsedMs).toISOString(),...sample,errors};
      } finally { page.off('pageerror',error);page.off('console',consoleError); }
    `,
    );
    report.segments.push(segment);
    await writeFile(join(directory, 'phase6-soak.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        segment: index + 1,
        elapsedMs: segment.elapsedMs,
        hiddenMs: segment.hiddenMs,
        suspendedFrames: segment.suspendedFrames,
        resources: segment.after,
        errors: segment.errors,
      }),
    );
  }
  report.completed = new Date().toISOString();
  report.sampledMs = report.segments.reduce((sum, segment) => sum + segment.elapsedMs, 0);
  report.validActiveRun = report.segments.every(
    (segment) =>
      !segment.hiddenMs &&
      !segment.suspendedFrames &&
      !segment.errors.length &&
      segment.renderedFrames > 0,
  );
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(directory, 'phase6-soak.json'), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    completed: report.completed,
    segments: report.segments.length,
    sampledMs: report.sampledMs,
    validActiveRun: report.validActiveRun,
    failure: report.failure,
  }),
);
