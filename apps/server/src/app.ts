import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { correlationId, type AppEnv } from '@invokeworks/shared';
import {
  createLiveAuthAdapter,
  createTestBypassAdapter,
  type LiveAuthAdapter,
} from '@invokeworks/liveauth';
import type { ToolDefinition } from '@invokeworks/tools';
import { createInvokeWorksMcp } from './mcp.js';
import { logger as defaultLogger, type Logger } from './logger.js';

export function createApp(
  config: AppEnv,
  deps: { liveAuth?: LiveAuthAdapter; logger?: Logger; registry?: ToolDefinition[] } = {},
) {
  const app = new Hono();
  const logger = deps.logger ?? defaultLogger;
  const liveAuth =
    deps.liveAuth ??
    (config.LIVEAUTH_BYPASS_FOR_TESTS === 'true'
      ? createTestBypassAdapter()
      : createLiveAuthAdapter({
          publicKey: config.LIVEAUTH_PUBLIC_KEY ?? '',
          baseUrl: config.LIVEAUTH_API_URL,
        }));
  const mcp = createInvokeWorksMcp({
    liveAuth,
    logger,
    ...(deps.registry ? { registry: deps.registry } : {}),
  });
  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    const requestId = correlationId(c.req.header('x-request-id'));
    c.header('x-request-id', requestId);
    const started = performance.now();
    await next();
    logger.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      'HTTP request',
    );
  });
  app.get('/health', (c) => c.json({ status: 'ok', service: 'invokeworks-mcp', version: '0.1.0' }));
  app.all('/mcp', (c) => mcp.fetch(c.req.raw));
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return { app, close: () => mcp.close() };
}
