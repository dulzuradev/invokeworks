import dns from 'node:dns/promises';
import { z } from 'zod';
import { defineTool } from './types.js';

export const dnsRecordType = z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA']);
export const dnsLookupInput = z.object({
  hostname: z.string().trim().min(1).max(253).describe('DNS hostname to query'),
  recordType: dnsRecordType.default('A'),
});

export interface DnsBackend {
  resolve(hostname: string, type: z.infer<typeof dnsRecordType>): Promise<unknown>;
}
const backend: DnsBackend = { resolve: (hostname, type) => dns.resolve(hostname, type) };

export function createDnsLookup(deps: { dns?: DnsBackend } = {}) {
  return defineTool({
    name: 'dns_lookup',
    displayName: 'DNS Lookup',
    priceSats: 1,
    description: 'Query public DNS records for a hostname.',
    longDescription:
      'Resolve A, AAAA, CNAME, MX, TXT, NS, or SOA records using the server DNS resolver.',
    inputSchema: dnsLookupInput,
    docs: { category: 'Network', examples: [{ hostname: 'example.com', recordType: 'MX' }] },
    async handler({ hostname, recordType }) {
      const normalized = hostname.toLowerCase().replace(/\.$/, '');
      const records = await (deps.dns ?? backend).resolve(normalized, recordType);
      return { data: { hostname: normalized, recordType, records } };
    },
  });
}
