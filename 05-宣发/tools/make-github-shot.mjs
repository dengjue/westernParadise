#!/usr/bin/env node
/**
 * 截取真实 GitHub 仓库页面，生成宣传片里的「项目证据」画面。
 *
 * 只截仓库页上半部（标题栏 / Public 徽章 / 导航 / 文件树 / About），
 * 几何上避开 README 渲染区 —— README 大标题含中文宗教题名，不可入镜。
 *
 * 产出：
 *   assets/github-raw.png   浏览器实截（2x，未经内容改写）
 *   assets/github-shot.png  裁切 + 缩放后的 960x600 成片素材
 *
 * 用法：node tools/make-github-shot.mjs
 * 依赖：macOS Chrome、可访问 github.com。改 DOM 只隐藏浏览器噪声，
 *      不修改仓库名、Star 数、文件树等任何真实数据。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO_URL = 'https://github.com/dengjue/westernParadise';
const CDP_PORT = 9224;
const PROFILE = `/tmp/temple-gh-shot-${process.pid}`;
const RAW = path.join(ROOT, 'assets', 'github-raw.png');
const OUT = path.join(ROOT, 'assets', 'github-shot.png');
const VIEW_W = 1280,
  VIEW_H = 1000,
  SCALE = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

async function waitForCDP() {
  for (let i = 0; i < 100; i++) {
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

async function main() {
  if (!existsSync(CHROME)) throw new Error(`缺少 Chrome：${CHROME}`);
  await fs.mkdir(path.join(ROOT, 'assets'), { recursive: true });

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
      '--lang=zh-CN',
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--window-size=${VIEW_W},${VIEW_H}`,
      `--force-device-scale-factor=${SCALE}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  try {
    await waitForCDP();
    const target = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
    ).json();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW_W,
      height: VIEW_H,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: REPO_URL });

    /* 等待仓库文件树真正渲染出来；GitHub 新 UI 为 React 异步挂载。
       国际链路可能较慢，给足 60s，并打印每次状态便于定位反爬挑战。 */
    let ready = false;
    let lastState = null;
    for (let i = 0; i < 200; i++) {
      const r = await cdp
        .send('Runtime.evaluate', {
          expression: `(() => ({
          state: document.readyState,
          title: document.title,
          url: location.href,
          tree: !!document.querySelector('#repo-content-pjax-container table, [data-testid="repository-file-list"], #readme, [role="grid"]'),
          repo: !!document.querySelector('strong[itemprop="name"] a, #repository-container-header a'),
          bodyLen: document.body ? document.body.innerText.length : 0,
          head: document.body ? document.body.innerText.slice(0, 220) : '',
        }))()`,
          returnByValue: true,
        })
        .catch((e) => ({ result: { value: { err: e.message } } }));
      const v = r.result?.value;
      lastState = v;
      if (i % 15 === 0) console.log(`  [${i}]`, JSON.stringify(v));
      if (
        v &&
        v.state === 'complete' &&
        v.bodyLen > 800 &&
        /westernParadise/i.test(v.title || '')
      ) {
        console.log('页面就绪：', v.title, '| bodyLen', v.bodyLen);
        ready = true;
        break;
      }
      await sleep(300);
    }
    if (!ready) {
      console.error('最后状态：', JSON.stringify(lastState));
      throw new Error('GitHub 仓库页未加载完成（可能是反爬或被限流）');
    }

    /* 页面原样实截：不改 DOM、不改任何仓库数据。
       全站黑条与含内部代号的 commit message 列，统一交给裁切脚本按坐标跳过/渐隐，
       这样截图仍然是真实浏览器渲染结果，可复核、可追溯。 */
    const info = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        window.scrollTo(0, 0);
        const r = (sel) => {
          const e = document.querySelector(sel);
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return [Math.round(b.top), Math.round(b.left), Math.round(b.width), Math.round(b.height)];
        };
        return { repoTitle: r('#repository-container-header'), table: r('table'),
                 scrollY: window.scrollY, bodyLen: document.body.innerText.length };
      })()`,
      returnByValue: true,
    });
    console.log('页面布局：', JSON.stringify(info.result?.value));

    await sleep(1200);

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: VIEW_W, height: 860, scale: SCALE },
    });
    await fs.writeFile(RAW, Buffer.from(shot.data, 'base64'));
    console.log('原始截图：', RAW);
  } finally {
    try {
      cdp?.close();
    } catch {
      /* 已断开 */
    }
    try {
      chrome.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
    await sleep(700);
    await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {});
  }

  /* 裁切/缩放交给 Python（Pillow），此脚本只负责真实截屏 */
  const { execFileSync } = await import('node:child_process');
  execFileSync('python3', [path.join(ROOT, 'tools', 'crop-github-shot.py')], { stdio: 'inherit' });
  console.log('成片素材：', OUT);
}

main().catch((e) => {
  console.error('截屏失败：', e.message);
  process.exit(1);
});
