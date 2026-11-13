/** A4 连续 30 分钟验收。新建有身份的报告，不覆盖 P6；任一无效段保留原始表并停止。 */
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, cpus, totalmem, freemem, loadavg } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const [tab, artifactPath = 'dist/single/index.html', task = 'A4性能验收', mode = 'acceptance'] =
  process.argv.slice(2);
if (!/^\d+$/.test(tab ?? '') || !['acceptance', 'smoke'].includes(mode))
  throw new Error(
    '用法：node scripts/run-land-acceptance-soak.mjs <tab-id> [产物路径] [任务名] [acceptance|smoke]',
  );
const segmentMs = mode === 'acceptance' ? 150000 : 1000,
  segments = mode === 'acceptance' ? 12 : 3;
const directory = resolve('reports'),
  run = Date.now().toString(),
  prefix = `followup-lighting-a4-${mode}-${run}`;
const bytes = await readFile(resolve(artifactPath));
const artifact = {
  path: resolve(artifactPath),
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const reportPath = join(directory, `${prefix}.json`),
  helper = pathToFileURL(resolve('scripts/record-land-soak.mjs')).href;
const summaryHelper = pathToFileURL(resolve('scripts/land-soak-timeline.mjs')).href;
const report = {
  run,
  mode,
  requested: { segmentMs, segments },
  started: new Date().toISOString(),
  artifact,
  checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  device: { cpu: cpus()[0]?.model, memoryBytes: totalmem() },
  diagnostics: {},
  segments: [],
  validActiveRun: false,
};
for (const name of [
  'record-land-soak.mjs',
  'land-soak-timeline.mjs',
  'run-land-acceptance-soak.mjs',
  'probe-land-phases.mjs',
])
  report.diagnostics[name] = createHash('sha256')
    .update(await readFile(resolve('scripts', name)))
    .digest('hex');
await mkdir(directory, { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });

/** 只读快照。ps 为近期进程占用，CPU ticks 是累计值；二者均不用于直接归因单帧。 */
function hostSnapshot() {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid,ppid,pcpu,pmem,rss,comm'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      return match
        ? {
            pid: +match[1],
            ppid: +match[2],
            cpu: +match[3],
            memoryPercent: +match[4],
            rssKiB: +match[5],
            executable: match[6],
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 16);
  return {
    at: new Date().toISOString(),
    topCpu: rows,
    cpuTimes: cpus().map((cpu) => cpu.times),
    freeBytes: freemem(),
    loadAverage: loadavg(),
    thermals: execFileSync('/usr/bin/pmset', ['-g', 'therm'], { encoding: 'utf8' }),
  };
}

let requestUncertain = false;

async function invoke(suffix, code) {
  const id = `${prefix}-${suffix}`;
  requestUncertain = true;
  report.lastRequest = id;
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(join(homedir(), '.local/bin/tabbit-cli'), [
      'nodejs',
      '--task',
      task,
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
    child.on('close', (exit) => resolveResult({ exit, stdout, stderr }));
    child.stdin.end(code);
  });
  await writeFile(join(directory, `${id}.receipt.json`), JSON.stringify(result, null, 2), {
    flag: 'wx',
  });
  const receipt = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .at(-1);
  if (['succeeded', 'failed', 'interrupted'].includes(receipt?.status)) requestUncertain = false;
  if (result.exit !== 0 || receipt?.status !== 'succeeded' || !receipt.result?.value)
    throw new Error(`请求 ${id} 未完成；保留回执并先恢复原请求，勿重跑已执行段`);
  return receipt.result.value;
}

try {
  report.hostBefore = hostSnapshot();
  report.setup = await invoke(
    'setup',
    `
    globalThis.landSoakErrors=[];globalThis.landSoakRequests=[];globalThis.landSoakAuditOverflow=false;
    globalThis.landSoakError=e=>{if(landSoakErrors.length<100)landSoakErrors.push(e.message);else landSoakAuditOverflow=true};
    globalThis.landSoakConsole=m=>{if(m.type()==='error')landSoakError({message:m.text()})};
    globalThis.landSoakRequest=r=>{if(/^https?:/.test(r.url())){if(landSoakRequests.length<100)landSoakRequests.push(r.url());else landSoakAuditOverflow=true}};
    page.on('pageerror',landSoakError);page.on('console',landSoakConsole);page.on('request',landSoakRequest);
    await context.setOffline(true);await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(${JSON.stringify(pathToFileURL(artifact.path).href + '?q=high&bench&tod=dawn&seed=20261113')},{waitUntil:'load'});
    await page.waitForFunction(()=>window.__G?.startup.firstFrameMs>0);
    const {configureLandGpuQueries}=await import(${JSON.stringify(pathToFileURL(resolve('scripts/probe-land-phases.mjs')).href)});
    const query=await configureLandGpuQueries(page,false);
    if(query.gpuAvailable||!query.extensionRestored||!query.remounted||query.canvases!==1)throw new Error('查询配置/挂载无效');
    await page.evaluate(async()=>{const g=window.__G;for(let view=0;view<4;view++){g.landCamera.selectView(view,true);for(const to of ['dawn','noon','dusk']){g.events.emit('tod:request',{to});do{await new Promise(r=>requestAnimationFrame(r))}while(g.world.lighting.transition.active);for(let frame=0;frame<12;frame++)await new Promise(r=>requestAnimationFrame(r))}}g.landCamera.selectView(0,true)});
    await page.getByRole('button',{name:'开启环境音',exact:true}).click();await page.waitForFunction(()=>window.__G.audio.context?.state==='running');
    const host=await tabbit.evaluate(async()=>({cpu:await chrome.system.cpu.getInfo(),memory:await chrome.system.memory.getInfo()}));
    if(landSoakErrors.length||landSoakRequests.length||landSoakAuditOverflow)throw new Error('预热出现错误或远程请求');
    const {installLandSoak}=await import(${JSON.stringify(helper)});const environment=await installLandSoak(page,{segmentMs:${segmentMs},segments:${segments}});
    return {query,host,environment,errors:[...landSoakErrors],requests:[...landSoakRequests]};
  `,
  );
  report.hostAfterWarmup = hostSnapshot();
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  for (let index = 1; index <= segments; index++) {
    const path = join(directory, `${prefix}-segment-${index}.json`);
    await invoke(
      `segment-${index}`,
      `
      const fs=await import('node:fs/promises'),{takeLandSoakSegment}=await import(${JSON.stringify(helper)}),{summarizeSoakSegment}=await import(${JSON.stringify(summaryHelper)});
      const sample=await takeLandSoakSegment(page);sample.artifact=${JSON.stringify(artifact)};
      sample.errors=[...landSoakErrors];sample.requests=[...landSoakRequests];sample.auditOverflow=landSoakAuditOverflow;
      sample.host=await tabbit.evaluate(async()=>({cpu:await chrome.system.cpu.getInfo(),memory:await chrome.system.memory.getInfo()}));
      const cdp=await context.newCDPSession(page);
      try{sample.nativeHeap=await cdp.send('Runtime.getHeapUsage')}catch(error){sample.nativeHeap={error:String(error)}}finally{await cdp.detach()}
      try{sample.summary=sample.frames?summarizeSoakSegment(sample):{valid:false}}catch(error){sample.summary={valid:false,error:String(error)}}
      if(sample.errors.length||sample.requests.length||sample.auditOverflow||!(sample.elapsedMs>=${segmentMs})||sample.after?.audio.state!=='running')sample.summary.valid=false;
      await fs.writeFile(${JSON.stringify(path)},JSON.stringify(sample),{flag:'wx'});
      return {path:${JSON.stringify(path)}};
    `,
    );
    // 大表只写本地文件；CLI 始终回短回执，避免资源分页影响连续采集。
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const segment = Object.fromEntries(Object.entries(saved).filter(([name]) => name !== 'values'));
    segment.path = path;
    segment.hostProcess = hostSnapshot();
    report.segments.push(segment);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        index,
        elapsedMs: segment.elapsedMs,
        frames: segment.frames,
        valid: segment.summary.valid,
        frameMs: segment.summary.frameMs,
        after: segment.after,
        path,
      }),
    );
    const previous = report.segments.at(-2);
    if (
      !segment.summary.valid ||
      segment.index !== index ||
      (previous && segment.startMs !== previous.endMs) ||
      !isDeepStrictEqual(segment.environment, report.setup.environment)
    )
      throw new Error('活动性、段连续性或文档身份无效，保留证据并停止');
  }
  report.completed = new Date().toISOString();
  report.sampledMs = report.segments.reduce((sum, s) => sum + s.elapsedMs, 0);
  report.workloadCovered =
    [0, 1, 2, 3].every((view) => report.segments.some((s) => s.summary.coverage.views[view] > 0)) &&
    [0, 1, 2].every((time) => report.segments.some((s) => s.summary.coverage.timeModes[time] > 0));
  report.validActiveRun =
    mode === 'acceptance' &&
    report.sampledMs >= 1800000 &&
    report.segments.length === 12 &&
    report.workloadCovered;
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  report.requestUncertain = requestUncertain;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
// 只有原请求已经结束才发清理；未知/传输失败必须先用同一 request-id 恢复回执。
if (!requestUncertain) {
  const cleanupPath = join(directory, `${prefix}-cleanup.json`);
  try {
    report.cleanup = await invoke(
      'cleanup',
      `
      const fs=await import('node:fs/promises'),{finishLandSoak}=await import(${JSON.stringify(helper)});const result=await finishLandSoak(page);
      await fs.writeFile(${JSON.stringify(cleanupPath)},JSON.stringify(result),{flag:'wx'});
      await page.evaluate(()=>window.__G?.events.emit('audio:request',{enabled:false}));
      if(globalThis.landSoakError)page.off('pageerror',landSoakError);
      if(globalThis.landSoakConsole)page.off('console',landSoakConsole);
      if(globalThis.landSoakRequest)page.off('request',landSoakRequest);
      delete globalThis.landSoakErrors;delete globalThis.landSoakRequests;delete globalThis.landSoakError;delete globalThis.landSoakConsole;delete globalThis.landSoakRequest;delete globalThis.landSoakAuditOverflow;
      await context.setOffline(false);await page.emulateMedia({reducedMotion:null});
      return {path:${JSON.stringify(cleanupPath)},status:result?.status,removed:result?.removed??true};
    `,
    );
    if (
      report.cleanup.status?.failure ||
      report.cleanup.status?.queuedSegments ||
      !report.cleanup.removed
    )
      report.validActiveRun = false;
  } catch (error) {
    report.cleanupFailure = String(error);
    report.validActiveRun = false;
    process.exitCode = 1;
  }
}
report.requestUncertain = requestUncertain;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    reportPath,
    sampledMs: report.sampledMs,
    validActiveRun: report.validActiveRun,
    failure: report.failure,
  }),
);
