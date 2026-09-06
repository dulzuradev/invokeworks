import { describe, expect, it, vi } from 'vitest';
import {
  bearerToken,
  liveAuthErrorMeta,
  createLiveAuthAdapter,
  type LiveAuthGate,
} from './index.js';

describe('LiveAuth adapter', () => {
  it('extracts strict bearer credentials', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('Basic abc')).toBeNull();
  });
  it('attributes price and idempotency to the public gate', async () => {
    const invoke = vi.fn(async (_token, input, handler, context, options) => {
      void context;
      void options;
      return handler(input, { liveAuth: { charge: { status: 'ok', receipt: 'signed' } } });
    });
    const adapter = createLiveAuthAdapter({
      publicKey: 'la_pk_test',
      baseUrl: 'https://api.liveauth.app',
      gateFactory: () => ({ invoke }) as LiveAuthGate,
    });
    const result = await adapter.invoke({
      token: 'jwt',
      toolName: 'dns_lookup',
      priceSats: 1,
      input: { hostname: 'example.com' },
      requestId: 'req-1',
      handler: async (input) => input,
    });
    expect(result.charge.receipt).toBe('signed');
    expect(invoke.mock.calls[0]?.[4]).toMatchObject({
      costSats: 1,
      idempotencyKey: 'req-1',
      toolMethodName: 'dns_lookup',
    });
  });
});

it('projects billed failure metadata without credentials or cause', () => {
  const meta = liveAuthErrorMeta({
    code: 'tool_execution_failed',
    idempotencyKey: 'client-id',
    cause: 'secret',
    charge: {
      status: 'ok',
      grossSats: 1,
      revenueEventId: 'event',
      jwt: 'secret',
      receipt: {
        body: { requestId: 'server-id', idempotencyKey: 'client-id', refreshToken: 'secret' },
      },
    },
  });
  expect(meta).toMatchObject({
    liveauth: {
      billed: true,
      grossSats: 1,
      revenueEventId: 'event',
      idempotencyKey: 'client-id',
      receipt: { body: { requestId: 'server-id' } },
    },
  });
  expect(JSON.stringify(meta)).not.toContain('secret');
});
it.each([
  'tool_inactive',
  'tool_unpublished',
  'tool_not_found',
  'budget_exceeded',
  'rate_limited',
  'denied',
])('projects denial %s', (reason) => {
  expect(liveAuthErrorMeta({ name: 'ChargeDeniedError', reason })).toEqual({
    liveauth: { status: 'deny', billed: false, reason },
  });
});
