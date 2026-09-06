import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  createLiveAuthAdapter,
  type LiveAuthAdapter,
  type LiveAuthGate,
} from '@invokeworks/liveauth';
import { createRequire } from 'node:module';
const sdkPath = createRequire(
  new URL('../../packages/liveauth/package.json', import.meta.url),
).resolve('@liveauth-labs/mcp-server');
const { createMcpGate } = await import(sdkPath);
import { parseEnv } from '@invokeworks/shared';
import {
  createDnsLookup,
  createHttpInspect,
  createTlsInspect,
  type ToolDefinition,
} from '@invokeworks/tools';
import { createApp } from '../../apps/server/src/app.js';

describe('MCP over HTTP through LiveAuth boundary', () => {
  let server: ServerType;
  let url: URL;
  const close = vi.fn();
  const invoke = vi.fn<LiveAuthAdapter['invoke']>(async (args) => ({
    output: await args.handler(args.input),
    charge: { status: 'ok', grossSats: args.priceSats, receipt: { signature: 'test' } },
  }));
  beforeEach(async () => {
    invoke.mockClear();
    const registry = [
      createDnsLookup({
        dns: {
          resolve: async (hostname) => {
            if (hostname === 'failure.example') throw new Error('Injected DNS failure');
            return ['93.184.216.34'];
          },
        },
      }),
      createHttpInspect(),
      createTlsInspect(),
    ] as unknown as ToolDefinition[];
    const built = createApp(parseEnv({ NODE_ENV: 'test' }), {
      liveAuth: { invoke },
      logger: { info: vi.fn(), error: vi.fn() },
      registry,
    });
    close.mockImplementation(built.close);
    server = serve({ fetch: built.app.fetch, port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  });
  afterEach(async () => {
    server.close();
    await close();
  });

  async function client(token = 'valid-token', requestId = 'req-integration') {
    const mcp = new Client({ name: 'invokeworks-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(url, {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            authorization: `Bearer ${token}`,
            'x-request-id': requestId,
          },
        }),
    });
    await mcp.connect(transport);
    return mcp;
  }

  it('discovers tools and calls one through the charging gate', async () => {
    const mcp = await client();
    try {
      const listed = await mcp.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'dns_lookup',
        'http_inspect',
        'tls_inspect',
      ]);
      const result = await mcp.callTool({
        name: 'dns_lookup',
        arguments: { hostname: 'example.com', recordType: 'A' },
      });
      expect(result.isError).not.toBe(true);
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0]?.[0]).toMatchObject({
        requestId: 'req-integration',
        priceSats: 1,
      });
    } finally {
      await mcp.close();
    }
  });
  it('rejects invalid arguments before charging', async () => {
    const mcp = await client();
    try {
      const result = await mcp.callTool({ name: 'dns_lookup', arguments: { hostname: '' } });
      expect(result.isError).toBe(true);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await mcp.close();
    }
  });
  it('returns gate authentication and charge failures as tool errors', async () => {
    invoke
      .mockRejectedValueOnce(new Error('LiveAuth authorization expired'))
      .mockRejectedValueOnce(new Error('LiveAuth budget exceeded'));
    const mcp = await client('expired');
    try {
      expect(
        (await mcp.callTool({ name: 'dns_lookup', arguments: { hostname: 'example.com' } }))
          .isError,
      ).toBe(true);
      expect(
        (await mcp.callTool({ name: 'dns_lookup', arguments: { hostname: 'example.com' } }))
          .isError,
      ).toBe(true);
    } finally {
      await mcp.close();
    }
  });
  it('rejects a missing authorization token', async () => {
    const mcp = await client('');
    try {
      const result = await mcp.callTool({
        name: 'dns_lookup',
        arguments: { hostname: 'example.com' },
      });
      expect(result.isError).toBe(true);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await mcp.close();
    }
  });
  it('returns a tool failure that occurs after gate authorization', async () => {
    const mcp = await client();
    try {
      const result = await mcp.callTool({
        name: 'dns_lookup',
        arguments: { hostname: 'failure.example' },
      });
      expect(result.isError).toBe(true);
      expect(invoke).toHaveBeenCalledOnce();
    } finally {
      await mcp.close();
    }
  });
  it('passes the same request id for retry-safe charging', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const mcp = await client('valid-token', 'stable-id');
      try {
        await mcp.callTool({ name: 'dns_lookup', arguments: { hostname: 'example.com' } });
      } finally {
        await mcp.close();
      }
    }
    expect(invoke.mock.calls.map((call) => call[0].requestId)).toEqual(['stable-id', 'stable-id']);
  });
  it('returns real SDK denial codes over MCP without charging', async () => {
    const adapter = createLiveAuthAdapter({
      publicKey: 'test',
      baseUrl: 'https://test.invalid',
      gateFactory: (options) =>
        createMcpGate({
          ...options,
          fetch: async (url: string) =>
            new Response(
              JSON.stringify(
                String(url).endsWith('/usage')
                  ? { status: 'active' }
                  : { status: 'deny', reason: 'tool_inactive', callsUsed: 0, satsUsed: 0 },
              ),
            ),
        }) as LiveAuthGate,
    });
    invoke.mockImplementationOnce((args) => adapter.invoke(args));
    const mcp = await client();
    try {
      const result = await mcp.callTool({
        name: 'dns_lookup',
        arguments: { hostname: 'example.com' },
      });
      expect(result.isError).toBe(true);
      expect(result._meta).toMatchObject({
        requestId: 'req-integration',
        liveauth: { reason: 'tool_inactive', billed: false },
      });
    } finally {
      await mcp.close();
    }
  });
  it('preserves a billed execution failure and receipt through the real SDK and MCP', async () => {
    const adapter = createLiveAuthAdapter({
      publicKey: 'test',
      baseUrl: 'https://test.invalid',
      gateFactory: (options) =>
        createMcpGate({
          ...options,
          fetch: async (url: string) =>
            new Response(
              JSON.stringify(
                String(url).endsWith('/usage')
                  ? { status: 'active' }
                  : {
                      status: 'ok',
                      grossSats: 1,
                      callsUsed: 1,
                      satsUsed: 1,
                      revenueEventId: 'event',
                      receipt: {
                        body: { idempotencyKey: 'req-integration', requestId: 'server-request' },
                      },
                    },
              ),
            ),
        }) as LiveAuthGate,
    });
    invoke.mockImplementationOnce((args) => adapter.invoke(args));
    const mcp = await client();
    try {
      const result = await mcp.callTool({
        name: 'dns_lookup',
        arguments: { hostname: 'failure.example' },
      });
      expect(result.isError).toBe(true);
      expect(result._meta).toMatchObject({
        requestId: 'req-integration',
        liveauth: {
          billed: true,
          grossSats: 1,
          revenueEventId: 'event',
          idempotencyKey: 'req-integration',
          receipt: { body: { requestId: 'server-request', idempotencyKey: 'req-integration' } },
        },
      });
      expect(JSON.stringify(result)).not.toContain('valid-token');
    } finally {
      await mcp.close();
    }
  });
  it('rejects malformed JSON', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
  it('rejects request bodies larger than 64 KiB', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(64 * 1024) }),
    });
    expect(response.status).toBe(413);
  });
});
