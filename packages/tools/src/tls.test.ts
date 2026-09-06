import { EventEmitter } from 'node:events';
import type tls from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import { createTlsInspect } from './tls.js';

const context = { correlationId: 'tls-test' };
const resolver = { lookup: async () => [{ address: '93.184.216.34', family: 4 as const }] };
function fixture(error?: Error) {
  const socket = Object.assign(new EventEmitter(), {
    getPeerCertificate: () => ({
      subject: { CN: 'example.com' },
      issuer: { CN: 'Fixture CA' },
      subjectaltname: 'DNS:example.com',
      valid_from: 'Jan 1 00:00:00 2026 GMT',
      valid_to: 'Jan 1 00:00:00 2030 GMT',
      fingerprint256: 'fixture',
    }),
    getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' }),
    getProtocol: () => 'TLSv1.3',
    end: vi.fn(),
    destroy: vi.fn(),
  });
  const connect = vi.fn(() => {
    queueMicrotask(() => (error ? socket.emit('error', error) : socket.emit('secureConnect')));
    return socket;
  });
  return { socket, connect, deps: { resolver, connect: connect as unknown as typeof tls.connect } };
}
describe('tls_inspect', () => {
  it('pins the public address, verifies certificates and returns typed certificate details', async () => {
    const { deps, socket, connect } = fixture();
    const { data } = await createTlsInspect(deps).handler(
      { hostname: 'example.com', port: 443 },
      context,
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '93.184.216.34',
        servername: 'example.com',
        rejectUnauthorized: true,
      }),
    );
    expect(data).toMatchObject({
      protocol: 'TLSv1.3',
      hostnameValid: true,
      certificate: { subject: { CN: 'example.com' }, issuer: { CN: 'Fixture CA' } },
    });
    expect(data.chain).toHaveLength(1);
    expect(socket.end).toHaveBeenCalledOnce();
  });
  it('preserves certificate error codes for audit classification', async () => {
    const error = Object.assign(new Error('expired'), { code: 'CERT_HAS_EXPIRED' });
    await expect(
      createTlsInspect(fixture(error).deps).handler(
        { hostname: 'example.com', port: 443 },
        context,
      ),
    ).rejects.toMatchObject({ code: 'CERT_HAS_EXPIRED' });
  });
  it('blocks private answers before opening a TLS connection', async () => {
    const { deps, connect } = fixture();
    deps.resolver = { lookup: async () => [{ address: '10.0.0.1', family: 4 }] };
    await expect(
      createTlsInspect(deps).handler({ hostname: 'example.com', port: 443 }, context),
    ).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});
