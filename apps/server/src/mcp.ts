import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { bearerToken, liveAuthErrorMeta, type LiveAuthAdapter } from '@invokeworks/liveauth';
import { tools, type ToolDefinition } from '@invokeworks/tools';
import { correlationId } from '@invokeworks/shared';
import type { Logger } from './logger.js';

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Tool invocation failed';
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\bla_(?:pk|sk)_[A-Za-z0-9_-]+\b/g, '[redacted-key]');
}

export function createInvokeWorksMcp(args: {
  liveAuth: LiveAuthAdapter;
  logger: Logger;
  registry?: ToolDefinition[];
}) {
  return createMcpHandler(
    ({ requestInfo }) => {
      const server = new McpServer({ name: 'InvokeWorks', version: '0.1.0' });
      const requestId = correlationId(requestInfo?.headers.get('x-request-id'));
      const token = bearerToken(requestInfo?.headers.get('authorization') ?? null);
      for (const tool of args.registry ?? tools) {
        server.registerTool(
          tool.name,
          {
            title: tool.displayName,
            description: `${tool.description} Price: ${tool.priceSats} sat${tool.priceSats === 1 ? '' : 's'}/call.`,
            inputSchema: tool.inputSchema,
          },
          async (input, context) => {
            const started = performance.now();
            try {
              if (!token)
                throw new Error(
                  'LiveAuth authorization required: send Authorization: Bearer <token>',
                );
              const result = await args.liveAuth.invoke({
                token,
                toolName: tool.name,
                priceSats: tool.priceSats,
                input,
                requestId,
                handler: (value) =>
                  tool.handler(value, { correlationId: requestId, signal: context.mcpReq.signal }),
              });
              args.logger.info(
                {
                  requestId,
                  mcpMethod: 'tools/call',
                  tool: tool.name,
                  durationMs: Math.round(performance.now() - started),
                  success: true,
                  chargeStatus: result.charge.status,
                  revenueEventId: result.charge.revenueEventId,
                },
                'MCP tool call',
              );
              return {
                content: [
                  { type: 'text' as const, text: JSON.stringify(result.output.data, null, 2) },
                ],
                structuredContent: result.output.data as Record<string, unknown>,
                _meta: { liveauth: result.charge, requestId },
              };
            } catch (error) {
              const errorMeta = liveAuthErrorMeta(error);
              const billing = errorMeta.liveauth as
                { reason?: string; billed?: boolean } | undefined;
              const message = billing?.reason
                ? `LiveAuth denied this tool call: ${billing.reason}`
                : billing?.billed
                  ? 'Tool execution failed after LiveAuth authorization'
                  : safeErrorMessage(error);
              args.logger.error(
                {
                  requestId,
                  mcpMethod: 'tools/call',
                  tool: tool.name,
                  durationMs: Math.round(performance.now() - started),
                  success: false,
                  errorType: error instanceof Error ? error.name : 'UnknownError',
                },
                'MCP tool call failed',
              );
              return {
                content: [{ type: 'text' as const, text: message }],
                isError: true,
                _meta: { requestId, ...errorMeta },
              };
            }
          },
        );
      }
      return server;
    },
    {
      legacy: 'stateless',
      responseMode: 'json',
      onerror: (error) => args.logger.error({ error: error.message }, 'MCP transport error'),
    },
  );
}
