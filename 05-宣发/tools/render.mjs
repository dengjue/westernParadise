#!/usr/bin/env node
/**
 * 宣传片母版逐帧导出。
 *
 * 做法：用 Chrome DevTools Protocol 打开 preview.html?render=1，
 * 对每一帧调用 window.__seek(t) 后截屏，得到完全确定的帧序列，
 * 再用 ffmpeg 合成 MP4（视频帧 + 程序化 BGM）。
 *
 * 稳定性设计（实测结论）：
 *  - headless Chrome 连续截图约 600 帧后会挂起或返回 -32000；
 *    因此每 BATCH 帧主动重启浏览器进程，并为每次 CDP 调用加超时。
 *  - 已存在的帧默认跳过（断点续跑）；改过母版后用 --force 全量重渲。
 *
 * 用法：node tools/render.mjs [--smoke] [--force]
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8733;
const CDP_PORT = 9223;
const FPS = 30;
const DURATION = 60;
const SHORT_DURATION = 30;
const BATCH = 300; // 每渲染 300 帧重启一次浏览器
const CDP_TIMEOUT = 12_000;
const FRAME_OUT = path.join(ROOT, '.render', 'export');
const DIST = path.join(ROOT, 'dist');
const PAGE_URL = `http://127.0.0.1:${PORT}/preview.html?render=1`;
const RESUME = !process.argv.includes('--force');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

/* 30s 抖音快剪版：成片时间段 -> 母版时间段（方案文档第 2 节） */
/* v0.3：30s 版不再只做「情绪精选」，而是压缩出完整的目的链：
   忙 -> 看见 -> 坦白做不完 -> 邀请一起建 -> GitHub 证据 -> 片尾行动指令 */
const SHORT_MAP = [
  { s0: 0, s1: 4, m0: 0 }, // M1 钩子 + 常驻邀请角标
  { s0: 4, s1: 9, m0: 13 }, // M3 莲池，先让人看见
  { s0: 9, s1: 14, m0: 24 }, // M4 坦白：还只是个原型
  { s0: 14, s1: 20, m0: 33 }, // M5 邀请 + 六类参与方式
  { s0: 20, s1: 26, m0: 45 }, // M6 GitHub 证据幕 + 还缺一起建的人
  { s0: 26, s1: 30, m0: 56 }, // M7 片尾 CTA
];
function shortToMaster(t) {
  const seg = SHORT_MAP.find((s) => t >= s.s0 && t < s.s1) ?? SHORT_MAP[SHORT_MAP.length - 1];
  return Math.min(DURATION, seg.m0 + (t - seg.s0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
 * 本地静态服务：避免 file:// 下批量图片加载的不确定性
 * ------------------------------------------------------------------------- */
function startServer() {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = path.join(ROOT, pathname);
    if (pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* ---------------------------------------------------------------------------
 * 极简 CDP 客户端（Node 22 内置 WebSocket），每次调用带超时
 * ------------------------------------------------------------------------- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(`${msg.error.message} (${msg.error.code})`));
      } else {
        resolve(msg.result);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }, CDP_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

async function waitForCDP() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return;
    } catch {
      /* Chrome 尚未就绪 */
    }
    await sleep(200);
  }
  throw new Error('Chrome CDP 端口未就绪');
}

async function waitReady(cdp) {
  for (let i = 0; i < 200; i++) {
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'window.__readyFlag === true',
        returnByValue: true,
      });
      if (r.result?.value === true) return;
    } catch {
      /* 执行上下文尚未创建 */
    }
    await sleep(200);
  }
  throw new Error('页面帧序列未加载完成（检查 .render/frames/ 是否存在）');
}

/* ---------------------------------------------------------------------------
 * 浏览器会话：可随时整体重启，释放连续截图累积的资源
 * ------------------------------------------------------------------------- */
async function launchChrome(batchIdx) {
  const profile = `/tmp/temple-render-${process.pid}-${batchIdx}`;
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      '--mute-audio',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1080,1920',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitForCDP();
  const target = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: PAGE_URL });
  await waitReady(cdp);
  return { chrome, cdp, profile };
}

async function shutdown(session) {
  if (!session) return;
  try {
    session.cdp.close();
  } catch {
    /* 连接已断 */
  }
  try {
    session.chrome.kill('SIGKILL');
  } catch {
    /* 进程已退出 */
  }
  await sleep(900); // 等待调试端口释放
  await fs.rm(session.profile, { recursive: true, force: true }).catch(() => {});
}

/* ---------------------------------------------------------------------------
 * 逐帧截图
 * ------------------------------------------------------------------------- */
async function screenshot(cdp, t) {
  let lastErr;
  for (let k = 0; k < 4; k++) {
    try {
      await cdp.send('Runtime.evaluate', { expression: `window.__seek(${t.toFixed(4)})` });
      return await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
        captureBeyondViewport: false,
      });
    } catch (e) {
      lastErr = e;
      await sleep(220);
    }
  }
  throw lastErr;
}

async function capture(sessions, outDir, frameCount, timeOf, label) {
  await fs.mkdir(outDir, { recursive: true });
  const started = Date.now();
  let skipped = 0,
    done = 0;
  for (let f = 0; f < frameCount; f++) {
    const file = path.join(outDir, String(f + 1).padStart(5, '0') + '.jpg');
    if (RESUME && existsSync(file)) {
      skipped++;
      continue;
    }

    /* 定期重启：避免 headless Chrome 连续截图约 600 帧后挂起 */
    if (sessions.rendered > 0 && sessions.rendered % BATCH === 0) {
      await shutdown(sessions.current);
      sessions.current = await launchChrome(++sessions.batch);
      console.log(`  ${label}: 已重启浏览器会话 #${sessions.batch}`);
    }

    let shot;
    try {
      shot = await screenshot(sessions.current.cdp, timeOf(f));
    } catch (e) {
      /* 单帧彻底失败时，重启会话再试一次 */
      console.warn(`  ${label}: 第 ${f} 帧失败，重启会话后重试（${e.message}）`);
      await shutdown(sessions.current);
      sessions.current = await launchChrome(++sessions.batch);
      shot = await screenshot(sessions.current.cdp, timeOf(f));
    }
    await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
    sessions.rendered++;
    done++;
    if (f % 150 === 0) {
      console.log(
        `  ${label}: ${f}/${frameCount} (${((f / frameCount) * 100).toFixed(0)}%)  ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
  }
  console.log(
    `  ${label}: 完成 ${done} 帧 / 跳过 ${skipped} 帧，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

function mux(frameDir, audio, output, duration) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-framerate',
      String(FPS),
      '-i',
      path.join(frameDir, '%05d.jpg'),
      '-i',
      audio,
      '-t',
      String(duration),
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '1',
      '-movflags',
      '+faststart',
      '-shortest',
      output,
    ],
    { stdio: 'inherit' },
  );
}

/* --------------------------------------------------------------------------- */
async function main() {
  for (const p of [
    CHROME,
    path.join(ROOT, 'assets', 'bgm.wav'),
    path.join(ROOT, '.render', 'frames', 'a_0001.jpg'),
  ]) {
    if (!existsSync(p)) throw new Error(`缺少前置文件：${p}`);
  }
  await fs.mkdir(DIST, { recursive: true });

  const server = await startServer();
  const sessions = { current: null, batch: 0, rendered: 0 };
  try {
    sessions.current = await launchChrome(0);
    console.log(`页面就绪（${RESUME ? '断点续跑' : '全量重渲'}），开始逐帧导出`);

    /* --smoke：只截七张关键帧，用于人工核对版式与素材 */
    if (process.argv.includes('--smoke')) {
      const smokeDir = path.join(FRAME_OUT, 'smoke');
      await fs.mkdir(smokeDir, { recursive: true });
      for (const t of [0.8, 8.0, 16.0, 27.0, 38.0, 48.0, 57.0]) {
        const shot = await screenshot(sessions.current.cdp, t);
        await fs.writeFile(
          path.join(smokeDir, `t${String(t).replace('.', '_')}.jpg`),
          Buffer.from(shot.data, 'base64'),
        );
      }
      console.log('冒烟帧已写入', smokeDir);
      return;
    }

    const masterDir = path.join(FRAME_OUT, 'master');
    await capture(sessions, masterDir, DURATION * FPS, (f) => f / FPS, '母版 60s');
    mux(
      masterDir,
      path.join(ROOT, 'assets', 'bgm.wav'),
      path.join(DIST, '数字庭院-60s-母版.mp4'),
      DURATION,
    );
    console.log('  母版 60s: 已合成 MP4');

    const shortDir = path.join(FRAME_OUT, 'short');
    await capture(
      sessions,
      shortDir,
      SHORT_DURATION * FPS,
      (f) => shortToMaster(f / FPS),
      '抖音 30s',
    );
    mux(
      shortDir,
      path.join(ROOT, 'assets', 'bgm.wav'),
      path.join(DIST, '数字庭院-30s-抖音版.mp4'),
      SHORT_DURATION,
    );
    console.log('  抖音 30s: 已合成 MP4');

    console.log('导出完成：');
    for (const f of await fs.readdir(DIST)) {
      const st = await fs.stat(path.join(DIST, f));
      console.log(`  dist/${f}  ${(st.size / 1024 / 1024).toFixed(2)} MB`);
    }
  } finally {
    await shutdown(sessions.current);
    server.close();
  }
}

main().catch((e) => {
  console.error('导出失败：', e.message);
  process.exit(1);
});
