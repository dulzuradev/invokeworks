import { expect, it, vi } from 'vitest';
import { createDnsLookup } from './dns.js';

it('normalizes and resolves DNS records', async () => {
  const resolve = vi.fn(async () => ['203.0.113.2']);
  const result = await createDnsLookup({ dns: { resolve } }).handler(
    { hostname: 'Example.COM.', recordType: 'A' },
    { correlationId: 'test' },
  );
  expect(resolve).toHaveBeenCalledWith('example.com', 'A');
  expect(result.data).toMatchObject({ hostname: 'example.com', records: ['203.0.113.2'] });
});
