import dns from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export class UnsafeDestinationError extends Error {
  constructor(message = 'Destination is not a publicly routable address') {
    super(message);
    this.name = 'UnsafeDestinationError';
  }
}

export interface AddressResolver {
  lookup(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>>;
}

export const systemResolver: AddressResolver = {
  async lookup(hostname) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
  },
};

const forbiddenNames = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google.internal.',
]);

export function isPublicAddress(address: string): boolean {
  if (!net.isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  const normalized =
    parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed;
  return normalized.range() === 'unicast';
}

export async function resolvePublicHost(
  hostname: string,
  resolver: AddressResolver = systemResolver,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  if (!normalized || forbiddenNames.has(normalized) || normalized.endsWith('.localhost')) {
    throw new UnsafeDestinationError('Local and metadata hostnames are forbidden');
  }
  const records = net.isIP(normalized)
    ? [{ address: normalized, family: net.isIP(normalized) as 4 | 6 }]
    : await resolver.lookup(normalized);
  if (records.length === 0) throw new UnsafeDestinationError('Hostname did not resolve');
  if (records.some(({ address }) => !isPublicAddress(address))) throw new UnsafeDestinationError();
  return records;
}

export function parsePublicHttpUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UnsafeDestinationError('Only HTTP(S) URLs are supported');
  if (url.username || url.password)
    throw new UnsafeDestinationError('Credential-bearing URLs are forbidden');
  if (url.port && Number(url.port) > 65535) throw new UnsafeDestinationError('Invalid port');
  return url;
}
