import { readFile, stat } from 'node:fs/promises';
import type { RequestListener } from 'node:http';
import { MULTIPLAYER_ENDPOINT } from '@/01-shared';
import { isLocalPrivateAddress } from './multiplayerPrivateAddress';
import { createMultiplayerServer } from './multiplayerServer';

const bindIp = process.argv[2] ?? '';
if (process.argv.length !== 3 || !isLocalPrivateAddress(bindIp)) {
  console.error('需要指定本机网卡的私网 IPv4');
  process.exit(1);
}

const { webPort } = MULTIPLAYER_ENDPOINT;
const origin = `http://${bindIp}:${webPort}`;
const index = new URL('./index.html', import.meta.url);
const types = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
};

function staticFiles(html: Buffer): RequestListener {
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = request.url?.split('?')[0];
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (
      path === '/phone-test' ||
      path === '/phone-test/' ||
      path === '/play' ||
      path === '/play/'
    ) {
      response
        .writeHead(302, {
          Location: path.startsWith('/play')
            ? '/?cam=third&multiplayer=1'
            : '/?cam=third&quality=low&crowdcheck=1',
          'Cache-Control': 'no-store',
        })
        .end();
      return;
    }
    if (path === '/' || path === '/index.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : html);
      return;
    }
    // 只读取本次构建输出的命名资源，不能访问部署目录或项目源码。
    const asset = /^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.exec(path ?? '');
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    const file = new URL(`.${asset[0]}`, import.meta.url);
    const contentType = types[asset[1] as keyof typeof types];
    void (request.method === 'HEAD' ? stat(file).then(() => undefined) : readFile(file)).then(
      (data) => {
        response
          .writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          })
          .end(data);
      },
      () => response.writeHead(404).end(),
    );
  };
}

const room = createMultiplayerServer({
  lanOrigin: origin,
  site: { host: bindIp, request: staticFiles(await readFile(index)) },
});
try {
  await room.listen(webPort);
  const stop = () => void room.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`${origin}/?scene=courtyard&multiplayer=1`);
} catch (error) {
  console.error(error);
  await room.close();
  process.exitCode = 1;
}
