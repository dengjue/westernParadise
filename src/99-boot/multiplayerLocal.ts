import { createMultiplayerServer, MULTIPLAYER_LOCAL } from './multiplayerServer';

const server = createMultiplayerServer();
try {
  const port = await server.listen();
  console.log(`多人开发服务：ws://${MULTIPLAYER_LOCAL.host}:${port}${MULTIPLAYER_LOCAL.path}`);
  const stop = () => void server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error('无法启动多人开发服务：', error);
  await server.close();
  process.exitCode = 1;
}
