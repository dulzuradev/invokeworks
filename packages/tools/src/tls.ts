import tls from 'node:tls';
import { z } from 'zod';
import { resolvePublicHost, systemResolver, type AddressResolver } from './network.js';
import { defineTool } from './types.js';

export const tlsInspectInput = z.object({
  hostname: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(443),
});

export function createTlsInspect(
  deps: { resolver?: AddressResolver; connect?: typeof tls.connect } = {},
) {
  return defineTool({
    name: 'tls_inspect',
    displayName: 'TLS Inspect',
    priceSats: 2,
    description: 'Inspect TLS negotiation and the certificate chain for a public endpoint.',
    longDescription:
      'Connects to a validated public destination and returns protocol, cipher, certificate identity, validity, and chain details.',
    inputSchema: tlsInspectInput,
    docs: { category: 'Network', examples: [{ hostname: 'example.com', port: 443 }] },
    async handler({ hostname, port }, context) {
      const normalized = hostname.toLowerCase().replace(/\.$/, '');
      const [pinned] = await resolvePublicHost(normalized, deps.resolver ?? systemResolver);
      if (!pinned) throw new Error('Hostname did not resolve');
      const socket = (deps.connect ?? tls.connect)({
        host: pinned.address,
        port,
        servername: normalized,
        rejectUnauthorized: true,
        timeout: 10_000,
      });
      return await new Promise((resolve, reject) => {
        const abort = () =>
          socket.destroy(
            context.signal?.reason instanceof Error ? context.signal.reason : new Error('Aborted'),
          );
        context.signal?.addEventListener('abort', abort, { once: true });
        const finish = () => context.signal?.removeEventListener('abort', abort);
        socket.once('error', (error) => {
          finish();
          reject(error);
        });
        socket.once('timeout', () => socket.destroy(new Error('TLS inspection timed out')));
        socket.once('secureConnect', () => {
          const certificate = socket.getPeerCertificate(true);
          const cipher = socket.getCipher();
          const validUntil = new Date(certificate.valid_to);
          const sans =
            certificate.subjectaltname?.split(', ').map((value) => value.replace(/^DNS:/, '')) ??
            [];
          const chain: Array<{
            subject: tls.PeerCertificate['subject'];
            issuer: tls.PeerCertificate['issuer'];
            fingerprint256: string;
          }> = [];
          let node = certificate;
          const seen = new Set<string>();
          while (node?.fingerprint256 && !seen.has(node.fingerprint256) && chain.length < 10) {
            seen.add(node.fingerprint256);
            chain.push({
              subject: node.subject,
              issuer: node.issuer,
              fingerprint256: node.fingerprint256,
            });
            node = node.issuerCertificate;
          }
          const data = {
            hostname: normalized,
            port,
            protocol: socket.getProtocol(),
            cipher: {
              name: cipher.name,
              version: cipher.version,
              standardName: cipher.standardName,
            },
            certificate: {
              subject: certificate.subject,
              issuer: certificate.issuer,
              sans,
              validFrom: certificate.valid_from,
              validUntil: certificate.valid_to,
              daysRemaining: Math.floor((validUntil.getTime() - Date.now()) / 86_400_000),
              fingerprint256: certificate.fingerprint256,
            },
            chain,
          };
          finish();
          socket.end();
          resolve({ data });
        });
      });
    },
  });
}
