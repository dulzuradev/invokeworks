import { performance } from 'node:perf_hooks';
import { Agent, fetch, type Dispatcher } from 'undici';
import { z } from 'zod';
import {
  parsePublicHttpUrl,
  resolvePublicHost,
  systemResolver,
  type AddressResolver,
} from './network.js';
import { defineTool } from './types.js';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;
const securityHeaderNames = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

export const httpInspectInput = z.object({ url: z.url().max(2048) });
interface FetchOptions {
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  maxRedirections: number;
  dispatcher: Dispatcher;
}
type Fetcher = (
  input: string,
  init: FetchOptions,
) => Promise<{ status: number; headers: HeadersLike; body: ReadableBody | null }>;

interface HeadersLike {
  get(name: string): string | null;
  forEach(callback: (value: string, key: string) => void): void;
}

interface ReadableBody {
  getReader(): {
    read(): Promise<{ done: boolean; value?: unknown }>;
    cancel(reason?: unknown): Promise<void>;
  };
}

async function drainBounded(body: ReadableBody | null): Promise<number> {
  if (!body) return 0;
  const reader = body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return total;
      if (!(value instanceof Uint8Array)) throw new Error('Unexpected response body chunk');
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error(`Response exceeds ${MAX_BYTES} byte limit`);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function safeHeaders(headers: HeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!['set-cookie', 'proxy-authenticate'].includes(key.toLowerCase())) out[key] = value;
  });
  return out;
}

export function createHttpInspect(deps: { resolver?: AddressResolver; fetcher?: Fetcher } = {}) {
  const resolver = deps.resolver ?? systemResolver;
  return defineTool({
    name: 'http_inspect',
    displayName: 'HTTP Inspect',
    priceSats: 2,
    description: 'Inspect a public HTTP/HTTPS endpoint, redirects, headers, and security posture.',
    longDescription:
      'Fetches a bounded response while blocking private destinations and validating every redirect.',
    inputSchema: httpInspectInput,
    docs: { category: 'Network', examples: [{ url: 'https://example.com' }] },
    async handler({ url: rawUrl }, context) {
      const started = performance.now();
      const redirects: Array<{ status: number; url: string }> = [];
      let current = parsePublicHttpUrl(rawUrl);
      for (let count = 0; count <= MAX_REDIRECTS; count++) {
        const addresses = await resolvePublicHost(current.hostname, resolver);
        const pinned = addresses[0]!;
        const dispatcher = new Agent({
          connect: {
            lookup: (_host, _opts, callback) => callback(null, pinned.address, pinned.family),
          },
        });
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(new Error('HTTP inspection timed out')),
          TIMEOUT_MS,
        );
        const abort = () => controller.abort(context.signal?.reason);
        context.signal?.addEventListener('abort', abort, { once: true });
        try {
          const response = deps.fetcher
            ? await deps.fetcher(current.href, {
                method: 'GET',
                headers: { 'user-agent': 'InvokeWorks/0.1 (+https://invokeworks.dev)' },
                signal: controller.signal,
                maxRedirections: 0,
                dispatcher,
              })
            : await fetch(current, {
                method: 'GET',
                redirect: 'manual',
                headers: {
                  'user-agent': 'InvokeWorks/0.1 (+https://invokeworks.dev)',
                  accept: '*/*',
                },
                signal: controller.signal,
                dispatcher,
              });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await drainBounded(response.body);
            if (!location) throw new Error('Redirect response lacks a Location header');
            if (count === MAX_REDIRECTS) throw new Error(`Exceeded ${MAX_REDIRECTS} redirects`);
            redirects.push({ status: response.status, url: current.href });
            current = parsePublicHttpUrl(new URL(location, current).href);
            continue;
          }
          const bytesRead = await drainBounded(response.body);
          const headers = safeHeaders(response.headers);
          return {
            data: {
              status: response.status,
              finalUrl: current.href,
              redirects,
              headers,
              contentType: response.headers.get('content-type'),
              contentLength: response.headers.get('content-length'),
              bytesRead,
              elapsedMs: Math.round(performance.now() - started),
              securityHeaders: Object.fromEntries(
                securityHeaderNames.map((name) => [name, response.headers.get(name)]),
              ),
            },
          };
        } finally {
          clearTimeout(timeout);
          context.signal?.removeEventListener('abort', abort);
          await dispatcher.close();
        }
      }
      throw new Error('Redirect limit exceeded');
    },
  });
}
