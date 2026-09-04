import { describe, expect, it, vi } from 'vitest';
import { bearerToken, createLiveAuthAdapter, type LiveAuthGate } from './index.js';

describe('LiveAuth adapter', () => {
  it('extracts strict bearer credentials', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('Basic abc')).toBeNull();
  });
  it('attributes price and idempotency to the public gate', async () => {
    const invoke = vi.fn(async (_token, input, handler, _context, _options) =>
      handler(input, { liveAuth: { charge: { status: 'ok', receipt: 'signed' } } }),
    );
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
