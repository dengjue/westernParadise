import { createServer } from 'vite';
import { MULTIPLAYER_ENDPOINT } from '@/01-shared';
import { createMultiplayerServer } from './multiplayerServer';
import { isLocalPrivateAddress } from './multiplayerPrivateAddress';

const bindIp = process.argv[2] ?? '';
if (process.argv.length !== 3 || !isLocalPrivateAddress(bindIp)) {
  console.error('用法：npm run dev:multiplayer:lan -- <本机网卡的私网 IPv4>');
  process.exit(1);
}

const { webPort, host, path } = MULTIPLAYER_ENDPOINT;
const origin = `http://${bindIp}:${webPort}`;
const room = createMultiplayerServer({ lanOrigin: origin });
let site: Awaited<ReturnType<typeof createServer>> | undefined;
let closing = false;
/** 先关闭房间，让 WebSocket 退出，再关闭同源入口。 */
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await room.close();
  await site?.close();
}

try {
  // 用回环随机端口避免和现有本机调试服务抢占端口；局域网始终只需访问 webPort。
  const roomPort = await room.listen(0);
  site = await createServer({
    define: { 'import.meta.env.COURTYARD_LAN_ORIGIN': JSON.stringify(origin) },
    server: {
      host: bindIp,
      port: webPort,
      strictPort: true,
      cors: false,
      proxy: { [path]: { target: `ws://${host}:${roomPort}`, ws: true } },
    },
  });
  await site.listen();
  console.log(`局域网联机庭院：${origin}/?scene=courtyard&multiplayer=1`);
  const stop = () => void close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error('无法启动局域网测试：', error);
  await close();
  process.exitCode = 1;
}
