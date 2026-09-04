import { serve } from '@hono/node-server';
import { parseEnv } from '@invokeworks/shared';
import { createApp } from './app.js';
import { logger } from './logger.js';

const config = parseEnv(process.env);
const { app, close } = createApp(config);
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  logger.info({ host: config.HOST, port: info.port }, 'InvokeWorks MCP server listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Graceful shutdown');
  server.close();
  await close();
  process.exitCode = 0;
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
