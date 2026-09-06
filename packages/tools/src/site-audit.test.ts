import { describe, expect, it, vi } from 'vitest';
import {
  createSiteAudit,
  normalizeSiteTarget,
  scoreSiteAudit,
  siteAuditInput,
  type SiteAuditDependencies,
} from './site-audit.js';
import { createHttpInspect } from './http.js';
import { tools } from './index.js';

const context = { correlationId: 'audit-test' };
const resolver = { lookup: async () => [{ address: '93.184.216.34', family: 4 as const }] };
const headers = {
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=()',
  server: 'fixture',
  'set-cookie': 'secret',
};
const tls: NonNullable<SiteAuditDependencies['tls']> = async ({ hostname, port }) => ({
  data: {
    hostname,
    port,
    protocol: 'TLSv1.3',
    hostnameValid: true,
    cipher: { name: 'test', version: 'TLSv1.3' },
    certificate: {
      subject: { CN: hostname },
      issuer: { CN: 'Fixture CA' },
      sans: [hostname],
      validFrom: '2026-01-01',
      validUntil: '2027-01-01',
      daysRemaining: 100,
      fingerprint256: 'fixture',
    },
    chain: [],
  },
});
function dependencies(): SiteAuditDependencies {
  return {
    resolver,
    tls,
    dns: async ({ hostname, recordType }) => ({
      data: { hostname, recordType, records: ['fixture'] },
    }),
    http: createHttpInspect({
      resolver,
      fetcher: async () => ({ status: 200, headers: new Headers(headers), body: null }),
    }).handler,
  };
}
async function audit(deps: SiteAuditDependencies = {}, target = 'https://example.com') {
  return (await createSiteAudit({ ...dependencies(), ...deps }).handler({ target }, context)).data;
}
describe('site_audit', () => {
  it('returns a complete HTTPS audit without response bodies or cookies', async () => {
    const result = await audit();
    expect(result).toMatchObject({
      target: 'https://example.com/',
      hostname: 'example.com',
      score: 100,
      issues: [],
      tls: { hostnameValid: true },
      http: { initialUrl: 'https://example.com/', https: true, server: 'fixture' },
    });
    expect(result.dns.records).toHaveProperty('AAAA');
    expect(result.securityHeaders?.strictTransportSecurity.present).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('normalizes bare hostnames, case, trailing dots, and fragments', async () => {
    expect((await audit({}, ' Example.COM. ')).target).toBe('https://example.com/');
    expect(normalizeSiteTarget('http://Example.com:8080/path?q=1#fragment').href).toBe(
      'http://example.com:8080/path?q=1',
    );
  });
  it('preserves redirects and checks final response headers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: 'https://example.com/end' }),
        body: null,
      })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(headers), body: null });
    const result = await audit(
      { http: createHttpInspect({ resolver, fetcher }).handler },
      'http://example.com',
    );
    expect(result.http).toMatchObject({
      finalUrl: 'https://example.com/end',
      redirects: [{ status: 301, url: 'http://example.com/' }],
    });
    expect(result.issues.map((i) => i.code)).toEqual(['http_insecure_hop']);
  });
  it('reports recommended missing headers and transparent deductions', async () => {
    const result = await audit({
      http: createHttpInspect({
        resolver,
        fetcher: async () => ({ status: 200, headers: new Headers(), body: null }),
      }).handler,
    });
    expect(result.issues).toHaveLength(6);
    expect(result.score).toBe(80);
    expect(result.issues.every((i) => i.message.includes('recommended'))).toBe(true);
  });
  it('recognizes CSP frame-ancestors as frame protection', async () => {
    const h = new Headers(headers);
    h.delete('x-frame-options');
    const result = await audit({
      http: createHttpInspect({
        resolver,
        fetcher: async () => ({ status: 200, headers: h, body: null }),
      }).handler,
    });
    expect(result.issues).toEqual([]);
  });
  it.each([
    ['CERT_HAS_EXPIRED', 'tls_certificate_expired'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_hostname_mismatch'],
    ['ECONNRESET', 'tls_failed'],
  ])('degrades safely for TLS error %s', async (code, finding) => {
    const result = await audit({
      tls: async () => {
        throw Object.assign(new Error('sensitive detail'), { code });
      },
    });
    expect(result.tls).toBeNull();
    expect(result.http).not.toBeNull();
    expect(result.issues.map((i) => i.code)).toEqual([finding]);
    expect(JSON.stringify(result)).not.toContain('sensitive detail');
  });
  it('keeps DNS and TLS when HTTP fails without claiming missing headers', async () => {
    const result = await audit({
      http: async () => {
        throw new Error('secret');
      },
    });
    expect(result.http).toBeNull();
    expect(result.securityHeaders).toBeNull();
    expect(result.tls).not.toBeNull();
    expect(result.issues.map((i) => i.code)).toEqual(['http_failed']);
    expect(result.score).toBe(75);
  });
  it('handles absent optional DNS records without failing', async () => {
    const result = await audit({
      dns: async ({ hostname, recordType }) => {
        if (recordType !== 'A') throw Object.assign(new Error(), { code: 'ENODATA' });
        return { data: { hostname, recordType, records: ['93.184.216.34'] } };
      },
    });
    expect(result.dns.records.AAAA).toEqual([]);
    expect(result.score).toBe(100);
  });
  it('reports DNS query errors separately from absent records', async () => {
    const result = await audit({
      dns: async () => {
        throw Object.assign(new Error(), { code: 'ETIMEOUT' });
      },
    });
    expect(result.dns.failedRecordTypes).toHaveLength(5);
    expect(result.issues[0]?.code).toBe('dns_lookup_failed');
  });
  it.each([
    '',
    ' ',
    'ftp://example.com',
    'mailto:user@example.com',
    'https://bad_host',
    'https://-bad.com',
    'https://a..com',
    'https://',
    'https://user:pass@example.com',
    'example.com/path',
    'https://example.com:99999',
    'https:///example.com',
  ])('rejects malformed target %j', (target) => {
    expect(siteAuditInput.safeParse({ target }).success).toBe(false);
  });
  it.each([
    'localhost',
    'foo.localhost',
    'https://127.0.0.1',
    'http://169.254.169.254',
    'http://10.1.2.3',
    'http://[::1]',
  ])('rejects local target %s', (target) => {
    expect(siteAuditInput.safeParse({ target }).success).toBe(false);
  });
  it('blocks private and mixed DNS before invoking any inspectors', async () => {
    const http = vi.fn();
    const tls = vi.fn();
    const dns = vi.fn();
    await expect(
      audit({
        resolver: {
          lookup: async () => [
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.1', family: 4 },
          ],
        },
        http,
        tls,
        dns,
      }),
    ).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
    expect(tls).not.toHaveBeenCalled();
    expect(dns).not.toHaveBeenCalled();
  });
  it('fails when the hostname cannot resolve', async () => {
    await expect(audit({ resolver: { lookup: async () => [] } })).rejects.toThrow();
  });
  it('preserves HTTP redirect SSRF protection', async () => {
    const fetcher = vi.fn(async () => ({
      status: 302,
      headers: new Headers({ location: 'http://127.0.0.1/' }),
      body: null,
    }));
    const result = await audit({ http: createHttpInspect({ resolver, fetcher }).handler });
    expect(result.issues.map((i) => i.code)).toContain('http_failed');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('detects expiring certificates and obsolete protocols', async () => {
    const result = await audit({
      tls: async (input, ctx) => {
        const result = await tls(input, ctx);
        result.data.certificate.daysRemaining = 10;
        result.data.protocol = 'TLSv1.1';
        return result;
      },
    });
    expect(result.issues.map((i) => i.code)).toEqual([
      'tls_certificate_expiring',
      'tls_obsolete_protocol',
    ]);
    expect(result.score).toBe(70);
  });
  it('clamps scoring and does not deduct informational findings', () => {
    expect(scoreSiteAudit([])).toBe(100);
    expect(scoreSiteAudit([{ severity: 'info', code: 'test', message: 'test' }])).toBe(100);
    expect(
      scoreSiteAudit(
        Array.from({ length: 8 }, () => ({
          severity: 'critical' as const,
          code: 'test',
          message: 'test',
        })),
      ),
    ).toBe(0);
  });
  it('registers exact prices and metadata', () => {
    expect(tools.map((t) => [t.name, t.priceSats])).toEqual([
      ['dns_lookup', 1],
      ['http_inspect', 2],
      ['tls_inspect', 2],
      ['site_audit', 5],
    ]);
    expect(createSiteAudit()).toMatchObject({
      displayName: 'Site Audit',
      name: 'site_audit',
      priceSats: 5,
    });
  });
});
