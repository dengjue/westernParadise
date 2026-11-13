/** A1 默认采样；A2 可追加 phases-on/off 或 plain-on/off 与轮次，条件均真实重挂。 */
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem, homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [
  tab,
  artifactPath = 'dist/single/index.html',
  mode = 'detailed',
  viewsText = '0,1,2,3',
  condition = 'native',
  roundsText = '3',
] = process.argv.slice(2);
if (
  !/^\d+$/.test(tab ?? '') ||
  !['light', 'detailed'].includes(mode) ||
  !/^[0-3](,[0-3])*$/.test(viewsText) ||
  ![
    'native',
    'phases-on',
    'phases-off',
    'plain-on',
    'plain-off',
    'submit-on',
    'submit-off',
  ].includes(condition) ||
  !/^[1-5]$/.test(roundsText)
)
  throw new Error(
    '用法：node scripts/run-land-lighting.mjs <tab-id> [产物路径] [light|detailed] [0,1,2,3] [native|phases-on/off|plain-on/off|submit-on/off] [1–5轮]',
  );
const views = viewsText.split(',').map(Number);
if (new Set(views).size !== views.length) throw new Error('景点不能重复；重复实验应使用独立 run');
const directory = resolve('reports'),
  run = `${Date.now()}-${mode}${condition === 'native' ? '' : `-${condition}`}`;
await mkdir(directory, { recursive: true });
const bytes = await readFile(resolve(artifactPath));
const artifact = {
  path: resolve(artifactPath),
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const source = pathToFileURL(resolve(artifactPath)).href + '?q=high&bench&tod=dawn&seed=20261113';
const helper = pathToFileURL(resolve('scripts/sample-land-lighting.mjs')).href;
const diagnosticFiles = [
  'run-land-lighting.mjs',
  'record-land-frames.mjs',
  'sample-land-lighting.mjs',
  'summarize-lighting-trace.mjs',
  'phase-clock.mjs',
  'probe-land-phases.mjs',
  'summarize-land-phases.mjs',
];
const diagnostics = Object.fromEntries(
  await Promise.all(
    diagnosticFiles.map(async (file) => [
      file,
      createHash('sha256')
        .update(await readFile(resolve('scripts', file)))
        .digest('hex'),
    ]),
  ),
);
const report = {
  run,
  started: new Date().toISOString(),
  artifact,
  mode,
  condition,
  checkoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diagnostics,
  device: { cpu: cpus()[0]?.model, memoryBytes: totalmem() },
  views: [],
};
const reportPath = join(directory, `followup-lighting-${run}.json`);

async function invoke(view) {
  const id = `lighting-${run}-view-${view}`;
  const path = join(directory, `followup-lighting-${run}-view-${view}.json`);
  const code = `
    const fs=await import('node:fs/promises'),errors=[],requests=[];
    const error=e=>errors.push(e.message),consoleError=m=>{if(m.type()==='error')errors.push(m.text())},request=r=>{if(/^https?:/.test(r.url()))requests.push(r.url())};
    page.on('pageerror',error);page.on('console',consoleError);page.on('request',request);
    try {
      await page.goto(${JSON.stringify(source)},{waitUntil:'load'});
      await page.waitForFunction(()=>window.__G?.startup.firstFrameMs>0);
      let queryCondition=null;
      if(${condition !== 'native'}) {
        const {configureLandGpuQueries}=await import(${JSON.stringify(pathToFileURL(resolve('scripts/probe-land-phases.mjs')).href)});
        queryCondition=await configureLandGpuQueries(page,${condition.endsWith('-on')});
      }
      const {sampleLandLighting}=await import(${JSON.stringify(helper)});
      const trace=await sampleLandLighting(page,{viewIndex:${view},rounds:${Number(roundsText)},detailed:${mode === 'detailed'},firstUse:${condition === 'native'},interruptions:${condition === 'native'},phases:${condition.startsWith('phases-') || condition.startsWith('submit-')},submission:${condition.startsWith('submit-')}});
      trace.queryCondition=queryCondition;
      trace.artifact=${JSON.stringify(artifact)};trace.errors=errors;trace.requests=requests;
      if(errors.length||requests.length){trace.summary.valid=false;trace.summary.targetMet=false}
      if(queryCondition && (!queryCondition.extensionRestored || !queryCondition.remounted || queryCondition.canvases!==1 || queryCondition.gpuAvailable!==queryCondition.enabled)) {
        trace.summary.valid=false;trace.summary.targetMet=false;
      }
      const {summarizeLandPhases}=await import(${JSON.stringify(pathToFileURL(resolve('scripts/summarize-land-phases.mjs')).href)});
      trace.phaseSummary=summarizeLandPhases(trace);
      if(trace.phaseSummary && !trace.phaseSummary.valid){trace.summary.valid=false;trace.summary.targetMet=false}
      await fs.writeFile(${JSON.stringify(path)},JSON.stringify(trace),{flag:'wx'});
      return {path:${JSON.stringify(path)},viewIndex:${view},frames:trace.frames,valid:trace.summary.valid,targetMet:trace.summary.targetMet};
    } finally {page.off('pageerror',error);page.off('console',consoleError);page.off('request',request)}
  `;
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(join(homedir(), '.local/bin/tabbit-cli'), [
      'nodejs',
      '--task',
      condition === 'native' ? '光阴性能采样' : '光阴长帧归因',
      '--tab',
      tab,
      '--request-id',
      id,
      '--timeout-ms',
      '170000',
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
  if (result.exit !== 0 || receipt?.status !== 'succeeded' || !receipt.result?.value)
    throw new Error(`请求未完成：检查 ${id}.receipt.json；恢复原 request，不重复已经执行的采样。`);
  // 原始表和完整摘要已由受管 Node 写入文件；CLI 只回短回执，避免大摘要转成资源页。
  const saved = JSON.parse(await readFile(receipt.result.value.path, 'utf8'));
  return {
    ...receipt.result.value,
    environment: saved.environment,
    summary: saved.summary,
    queryCondition: saved.queryCondition,
    phaseSummary: saved.phaseSummary,
    errors: saved.errors,
    requests: saved.requests,
  };
}

try {
  for (const view of views) {
    const sample = await invoke(view);
    report.views.push(sample);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    const measured = sample.summary.segments.filter((s) => s.kind === 'measured');
    console.log(
      JSON.stringify({
        run,
        view,
        valid: sample.summary.valid,
        targetMet: sample.summary.targetMet,
        frames: sample.frames,
        p95: measured.map((s) => s.acceptanceFrameMs?.p95),
        max: measured.map((s) => s.acceptanceFrameMs?.max),
        path: sample.path,
      }),
    );
    if (!sample.summary.valid) throw new Error('采样负载或证据无效，保留数据并停止后续景点');
    const first = report.views[0].environment;
    if (
      JSON.stringify([
        sample.environment.viewport,
        sample.environment.renderRatio,
        sample.environment.quality,
      ]) !== JSON.stringify([first.viewport, first.renderRatio, first.quality])
    )
      throw new Error('景点之间设备像素/画质条件发生改变');
  }
  report.completed = new Date().toISOString();
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ reportPath, completed: report.completed, failure: report.failure }));
