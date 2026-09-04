import { describe, expect, it, vi } from 'vitest';
import { createHttpInspect } from './http.js';

const context = { correlationId: 'test' };
const publicResolver = {
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]),
};

describe('http_inspect', () => {
  it('returns structured inspection output', async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      headers: new Headers({
        'content-type': 'text/plain',
        'content-security-policy': "default-src 'none'",
      }),
      body: new Response('hello').body,
    }));
    const result = await createHttpInspect({ resolver: publicResolver, fetcher }).handler(
      { url: 'https://example.com' },
      context,
    );
    expect(result.data).toMatchObject({
      status: 200,
      finalUrl: 'https://example.com/',
      bytesRead: 5,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('blocks redirect to a forbidden address before the second fetch', async () => {
    const fetcher = vi.fn(async () => ({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }),
      body: null,
    }));
    const tool = createHttpInspect({ resolver: publicResolver, fetcher });
    await expect(tool.handler({ url: 'https://example.com' }, context)).rejects.toThrow(
      'publicly routable',
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('blocks a hostname resolving to private space without fetching', async () => {
    const fetcher = vi.fn();
    const tool = createHttpInspect({
      resolver: { lookup: async () => [{ address: '10.0.0.4', family: 4 }] },
      fetcher,
    });
    await expect(tool.handler({ url: 'https://internal.example' }, context)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('enforces the response-size ceiling', async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      body: new Response(new Uint8Array(256 * 1024 + 1)).body,
    }));
    await expect(
      createHttpInspect({ resolver: publicResolver, fetcher }).handler(
        { url: 'https://example.com' },
        context,
      ),
    ).rejects.toThrow('byte limit');
  });
});
