/** 单景点 Chromium 主线程/GPU 轨迹诊断；Tracing 与 phase 探针有额外开销，不作性能验收。 */
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [
  tab,
  artifactPath = 'reports/followup-lighting-a3-final.html',
  viewText = '3',
  task = 'A4性能验收',
] = process.argv.slice(2);
if (!/^\d+$/.test(tab ?? '') || !/^[0-3]$/.test(viewText))
  throw new Error(
    '用法：node scripts/run-land-lighting-trace.mjs <tab-id> [产物路径] [景点0-3] [任务名]',
  );

const view = Number(viewText),
  artifactFile = resolve(artifactPath);
const artifactBytes = await readFile(artifactFile);
const artifact = {
  path: artifactFile,
  bytes: artifactBytes.length,
  sha256: createHash('sha256').update(artifactBytes).digest('hex'),
};
const directory = resolve('reports'),
  run = Date.now().toString();
const reportPath = join(directory, `followup-lighting-a4-trace-${run}.json`);
const tracePath = join(directory, `followup-lighting-a4-trace-${run}.events.json`);
const source = pathToFileURL(artifactFile).href + '?q=high&bench&tod=dawn&seed=20261113';
const sampleUrl = pathToFileURL(resolve('scripts/sample-land-lighting.mjs')).href;
const summarizeUrl = pathToFileURL(resolve('scripts/summarize-land-phases.mjs')).href;
const diagnosticNames = [
  'run-land-lighting-trace.mjs',
  'sample-land-lighting.mjs',
  'record-land-frames.mjs',
  'probe-land-phases.mjs',
  'summarize-land-phases.mjs',
  'summarize-lighting-trace.mjs',
];
const diagnostics = Object.fromEntries(
  await Promise.all(
    diagnosticNames.map(async (name) => [
      name,
      createHash('sha256')
        .update(await readFile(resolve('scripts', name)))
        .digest('hex'),
    ]),
  ),
);
const report = {
  run,
  purpose: 'diagnostic-only; native tracing and phase probes perturb the measured workload',
  started: new Date().toISOString(),
  artifact,
  checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  device: { cpu: cpus()[0]?.model, memoryBytes: totalmem() },
  diagnostics,
  view,
  tracePath,
  reportPath,
};
try {
  const displays =
    JSON.parse(
      execFileSync('/usr/sbin/system_profiler', ['-json', 'SPDisplaysDataType'], {
        encoding: 'utf8',
      }),
    ).SPDisplaysDataType ?? [];
  report.displayModes = displays.flatMap((gpu) =>
    (gpu.spdisplays_ndrvs ?? []).map((display) => ({
      gpu: gpu._name,
      display: display._name,
      resolutionAndRefresh: display._spdisplays_resolution,
      connection: display.spdisplays_connection_type,
      internal: display.spdisplays_connection_type === 'spdisplays_internal',
    })),
  );
} catch (error) {
  report.displayModeReadError = String(error);
}
await mkdir(directory, { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });

const requestId = `a4-native-trace-${run}`;
const code = `
  const fs=await import('node:fs/promises'),zlib=await import('node:zlib'),{promisify}=await import('node:util');
  const gzip=promisify(zlib.gzip), errors=[],requests=[],error=e=>errors.push(e.message),consoleError=m=>{if(m.type()==='error')errors.push(m.text())},request=r=>{if(/^https?:/.test(r.url()))requests.push(r.url())};
  page.on('pageerror',error);page.on('console',consoleError);page.on('request',request);
  let cdp=null,tracing=false,traceEvents=[],eventCounts={},totalEvents=0,estimatedBytes=0,eventOverflow=false,traceCompletePromise=Promise.resolve(),sample=null,queryCondition=null,initial=null,performanceBefore=null,traceSaved=false,frameId=null,rendererPid=null,mainTid=null;
  const important=new Set(['RunTask','ThreadControllerImpl::RunTask','ProcessTaskFromWorkQueue','FireAnimationFrame','FunctionCall','EventDispatch','UpdateLayoutTree','UpdateLayerTree','Paint','RasterTask','CompositeLayers','BeginMainFrame','Commit','V8.Sample','Profile','ProfileChunk','JitCodeAdded']);
  try {
    await context.setOffline(true);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(${JSON.stringify(source)},{waitUntil:'load'});
    await page.waitForFunction(()=>window.__G?.startup.firstFrameMs>0);
    const {configureLandGpuQueries}=await import(${JSON.stringify(pathToFileURL(resolve('scripts/probe-land-phases.mjs')).href)});
    queryCondition=await configureLandGpuQueries(page,false);
    if(queryCondition.gpuAvailable||!queryCondition.extensionRestored||!queryCondition.remounted||queryCondition.canvases!==1)throw new Error('GPU 查询关闭后的真实重挂验证失败');
    initial=await page.evaluate(view=>{const g=window.__G;if(document.hidden||!document.hasFocus()||g.landCamera.suspended||g.landCamera.modal)throw new Error('Trace 要求页面可见、聚焦且未暂停');g.landCamera.selectView(view,true);return{url:location.href,viewport:[innerWidth,innerHeight,devicePixelRatio],drawingBuffer:[g.renderer.domElement.width,g.renderer.domElement.height],quality:g.quality,renderRatio:g.renderer.getPixelRatio(),timeOrigin:performance.timeOrigin,userAgent:navigator.userAgent,view,gpuAvailable:g.renderBudget.telemetry.gpuAvailable}},${view});
    cdp=await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    performanceBefore=await cdp.send('Performance.getMetrics');
    frameId=(await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    const timing=async()=>({pageNow:await page.evaluate(()=>performance.now()),cdpTimestamp:(await cdp.send('Performance.getMetrics')).metrics.find(metric=>metric.name==='Timestamp')?.value??null});
    const syncBefore=await timing();
    cdp.on('Tracing.dataCollected',chunk=>{for(const event of chunk.value??[]){totalEvents++;const name=event.name??'(unnamed)';eventCounts[name]=(eventCounts[name]??0)+1;if(event.args?.data?.frame===frameId){rendererPid=event.pid;mainTid=event.tid}const gc=/GC|GarbageCollect/i.test(name)&&rendererPid!==null&&event.pid===rendererPid;const mainThreadEvent=rendererPid!==null&&event.pid===rendererPid&&event.tid===mainTid&&important.has(name);if(!gc&&!mainThreadEvent)continue;if(traceEvents.length>=100000){eventOverflow=true;continue}const compact={name,cat:event.cat,ph:event.ph,ts:event.ts,dur:event.dur,pid:event.pid,tid:event.tid,args:event.args};const size=JSON.stringify(compact).length;if(estimatedBytes+size>48*1024*1024){eventOverflow=true;continue}estimatedBytes+=size;traceEvents.push(compact)}});
    cdp.on('Tracing.bufferUsage',usage=>{if(usage.value>0.85)eventOverflow=true});
    traceCompletePromise=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,disabled-by-default-v8.cpu_profiler',transferMode:'ReportEvents',bufferUsageReportingInterval:1000});
    tracing=true;
    const {sampleLandLighting}=await import(${JSON.stringify(sampleUrl)});
    sample=await sampleLandLighting(page,{viewIndex:${view},rounds:3,detailed:true,firstUse:true,interruptions:false,phases:true,submission:false});
    sample.queryCondition=queryCondition;sample.artifact=${JSON.stringify(artifact)};sample.errors=errors;sample.requests=requests;
    const {summarizeLandPhases}=await import(${JSON.stringify(summarizeUrl)});sample.phaseSummary=summarizeLandPhases(sample);
    await cdp.send('Tracing.end');
    const syncAfter=await timing();
    const complete=await Promise.race([traceCompletePromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tracing.tracingComplete 30 秒内未返回')),30000))]);
    tracing=false;
    const after=await cdp.send('Performance.getMetrics');
    const traceReport={version:1,run:${JSON.stringify(run)},finishedAt:new Date().toISOString(),initial,queryCondition,cdpDomains:{Profiler:'unavailable from prior probe',Tracing:'available',Performance:'available'},sync:{before:syncBefore,after:syncAfter,traceTimestampUnit:'microseconds; map to page performance.now via paired CDP Timestamp seconds'},renderer:{frameId,processId:rendererPid,mainThreadId:mainTid},trace:{totalEvents,retainedEvents:traceEvents.length,estimatedBytes,eventOverflow,complete:!!complete,streamFormat:'Chromium Trace Event compact JSON; args preserved for retained events',categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,disabled-by-default-v8.cpu_profiler'},eventCounts,traceEvents,sample,performanceBefore,performanceAfter:after,errors,requests};
    const bytes=await gzip(Buffer.from(JSON.stringify(traceReport)),{level:6});
    await fs.writeFile(${JSON.stringify(tracePath + '.gz')},bytes,{flag:'wx'});
    traceSaved=true;
    const summary={run:${JSON.stringify(run)},tracePath:${JSON.stringify(tracePath + '.gz')},traceBytes:bytes.byteLength,totalEvents,retainedEvents:traceEvents.length,estimatedBytes,eventOverflow,view:${view},frames:sample.frames,valid:sample.summary.valid,phaseValid:sample.phaseSummary?.valid,longIntervals:sample.phaseSummary?.longIntervals,phaseLongest:sample.phaseSummary?.longest,artifact:${JSON.stringify(artifact)},errors,requests};
    return {summary,tracePath:${JSON.stringify(tracePath + '.gz')}};
  } finally {
    if(tracing){try{await cdp.send('Tracing.end');await Promise.race([traceCompletePromise,new Promise(resolve=>setTimeout(resolve,10000))])}catch{}}
    if(!traceSaved&&initial){try{const partial={version:1,run:${JSON.stringify(run)},partial:true,initial,queryCondition,renderer:{frameId,processId:rendererPid,mainThreadId:mainTid},trace:{totalEvents,retainedEvents:traceEvents.length,estimatedBytes,eventOverflow,streamFormat:'Chromium Trace Event compact JSON'},eventCounts,traceEvents,sample,errors,requests};const bytes=await gzip(Buffer.from(JSON.stringify(partial)),{level:6});await fs.writeFile(${JSON.stringify(tracePath + '.partial.gz')},bytes,{flag:'wx'})}catch{}}
    if(cdp){try{await cdp.send('Performance.disable')}catch{}await cdp.detach()}
    page.off('pageerror',error);page.off('console',consoleError);page.off('request',request);
    await context.setOffline(false);
  }
`;

const cli = join(homedir(), '.local/bin/tabbit-cli');
const result = await new Promise((resolveResult, reject) => {
  const child = spawn(cli, [
    'nodejs',
    '--task',
    task,
    '--tab',
    tab,
    '--request-id',
    requestId,
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
await writeFile(join(directory, `${requestId}.receipt.json`), JSON.stringify(result, null, 2), {
  flag: 'wx',
});
const receipt = result.stdout
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line))
  .at(-1);
if (result.exit !== 0 || receipt?.status !== 'succeeded' || !receipt.result?.value) {
  report.failure = `request=${requestId}; exit=${result.exit}; inspect receipt before retry`;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  throw new Error(
    `Trace 请求未成功；先检查 ${requestId}.receipt.json 和同一 request-id，不要直接重跑。`,
  );
}
Object.assign(report, receipt.result.value.summary);
report.finished = new Date().toISOString();
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    reportPath,
    tracePath: report.tracePath,
    frames: report.frames,
    valid: report.valid,
    phaseValid: report.phaseValid,
    longIntervals: report.longIntervals,
    eventCount: report.totalEvents,
    retainedEvents: report.retainedEvents,
    eventOverflow: report.eventOverflow,
    failure: report.failure,
  }),
);
