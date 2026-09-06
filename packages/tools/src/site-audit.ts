import net from 'node:net';
import { z } from 'zod';
import { createDnsLookup } from './dns.js';
import { createHttpInspect } from './http.js';
import { createTlsInspect, type TlsInspectResult } from './tls.js';
import {
  isPublicAddress,
  parsePublicHttpUrl,
  resolvePublicHost,
  type AddressResolver,
} from './network.js';
import { defineTool, type ToolContext } from './types.js';

export function normalizeSiteTarget(target: string): URL {
  const input = target.trim();
  if (!input || /[\s\\]/.test(input)) throw new Error('Invalid website target');
  // Bare input is a hostname, not an implicit URL with a path, port or credentials.
  if (input.includes('://') && !/^https?:\/\/[^/]/i.test(input))
    throw new Error('Invalid HTTP(S) URL');
  const raw = input.includes('://') ? input : `https://${input}`;
  if (!input.includes('://') && /[/:?#@]/.test(input))
    throw new Error('Expected a hostname or HTTP(S) URL');
  const url = parsePublicHttpUrl(raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host.length > 253 ||
    !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error('Invalid hostname');
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'localhost.localdomain' ||
    host === 'metadata.google.internal' ||
    (net.isIP(host) && !isPublicAddress(host))
  ) {
    throw new Error('Expected a public hostname');
  }
  url.hostname = host;
  url.hash = '';
  return url;
}

export const siteAuditInput = z.object({
  target: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        normalizeSiteTarget(value);
        return true;
      } catch {
        return false;
      }
    }, 'Expected a public hostname or valid HTTP(S) URL')
    .describe('Public HTTP(S) URL or bare hostname (defaults to HTTPS)'),
});
export type SiteAuditInput = z.infer<typeof siteAuditInput>;
export interface SiteAuditIssue {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
}
const headerNames = {
  strictTransportSecurity: 'strict-transport-security',
  contentSecurityPolicy: 'content-security-policy',
  xContentTypeOptions: 'x-content-type-options',
  xFrameOptions: 'x-frame-options',
  referrerPolicy: 'referrer-policy',
  permissionsPolicy: 'permissions-policy',
} as const;
export type SiteAuditSecurityHeaders = Record<
  keyof typeof headerNames,
  {
    present: boolean;
    value: string | null;
    applicable: boolean;
  }
>;
type HttpResult = Awaited<ReturnType<ReturnType<typeof createHttpInspect>['handler']>>['data'];
type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS';
export interface SiteAuditResult {
  target: string;
  hostname: string;
  dns: { records: Record<DnsType, unknown>; failedRecordTypes: DnsType[] };
  tls: TlsInspectResult | null;
  http: (HttpResult & { initialUrl: string; https: boolean; server: string | null }) | null;
  securityHeaders: SiteAuditSecurityHeaders | null;
  issues: SiteAuditIssue[];
  score: number;
}
export interface SiteAuditDependencies {
  resolver?: AddressResolver;
  dns?: ReturnType<typeof createDnsLookup>['handler'];
  tls?: ReturnType<typeof createTlsInspect>['handler'];
  http?: ReturnType<typeof createHttpInspect>['handler'];
}

// Informational heuristic only: 25 per critical, 5 per warning, 0 per info,
// clamped to [0,100]. Unavailable checks generate findings, not a clean bill of health.
export function scoreSiteAudit(issues: SiteAuditIssue[]): number {
  return Math.max(
    0,
    100 -
      issues.reduce((sum, issue) => sum + { critical: 25, warning: 5, info: 0 }[issue.severity], 0),
  );
}
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

export async function auditSite(
  input: SiteAuditInput,
  context: ToolContext,
  deps: SiteAuditDependencies = {},
): Promise<SiteAuditResult> {
  const url = normalizeSiteTarget(input.target);
  // Reject unresolved/mixed/private destinations before starting any inspection.
  // HTTP and TLS also resolve and pin independently, preserving rebinding defenses.
  await resolvePublicHost(url.hostname, deps.resolver);
  const dns = deps.dns ?? createDnsLookup().handler;
  const tls =
    deps.tls ?? createTlsInspect(deps.resolver ? { resolver: deps.resolver } : {}).handler;
  const http =
    deps.http ?? createHttpInspect(deps.resolver ? { resolver: deps.resolver } : {}).handler;
  const types: DnsType[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS'];
  const [dnsResults, tlsResult, httpResult] = await Promise.all([
    Promise.allSettled(
      types.map((recordType) => dns({ hostname: url.hostname, recordType }, context)),
    ),
    Promise.allSettled([
      tls(
        { hostname: url.hostname, port: url.protocol === 'https:' ? Number(url.port || 443) : 443 },
        context,
      ),
    ]).then((results) => results[0]!),
    Promise.allSettled([http({ url: url.href }, context)]).then((results) => results[0]!),
  ]);
  const issues: SiteAuditIssue[] = [];
  const add = (severity: SiteAuditIssue['severity'], code: string, message: string) =>
    issues.push({ severity, code, message });
  const records: Record<DnsType, unknown> = { A: [], AAAA: [], CNAME: [], MX: [], NS: [] };
  const failedRecordTypes: DnsType[] = [];
  dnsResults.forEach((result, index) => {
    const type = types[index]!;
    if (result.status === 'fulfilled') records[type] = result.value.data.records;
    else if (!['ENODATA', 'ENOTFOUND'].includes(errorCode(result.reason) ?? ''))
      failedRecordTypes.push(type);
  });
  if (failedRecordTypes.length)
    add('warning', 'dns_lookup_failed', 'Some DNS record queries could not be completed.');
  const tlsData = tlsResult.status === 'fulfilled' ? tlsResult.value.data : null;
  if (tlsResult.status === 'rejected') {
    const code = errorCode(tlsResult.reason);
    if (code === 'CERT_HAS_EXPIRED')
      add('critical', 'tls_certificate_expired', 'TLS certificate has expired.');
    else if (code === 'ERR_TLS_CERT_ALTNAME_INVALID')
      add('critical', 'tls_hostname_mismatch', 'TLS certificate does not match the hostname.');
    else add('critical', 'tls_failed', 'TLS negotiation or certificate verification failed.');
  } else if (tlsData) {
    if (tlsData.certificate.daysRemaining < 0)
      add('critical', 'tls_certificate_expired', 'TLS certificate has expired.');
    else if (tlsData.certificate.daysRemaining <= 30)
      add('warning', 'tls_certificate_expiring', 'TLS certificate expires within 30 days.');
    if (!tlsData.hostnameValid)
      add('critical', 'tls_hostname_mismatch', 'TLS certificate does not match the hostname.');
    if (tlsData.protocol && /^(SSL|TLSv1(?:\.0|\.1)?$)/.test(tlsData.protocol))
      add('critical', 'tls_obsolete_protocol', 'TLS negotiated an obsolete protocol.');
  }
  const httpData =
    httpResult.status === 'fulfilled'
      ? {
          ...httpResult.value.data,
          initialUrl: url.href,
          https: new URL(httpResult.value.data.finalUrl).protocol === 'https:',
          server: httpResult.value.data.headers.server ?? null,
        }
      : null;
  let securityHeaders: SiteAuditSecurityHeaders | null = null;
  if (!httpData)
    add(
      'critical',
      'http_failed',
      'HTTP inspection could not be completed; security headers were not evaluated.',
    );
  else {
    if (!httpData.https)
      add('critical', 'http_not_https', 'The final HTTP response is not encrypted with HTTPS.');
    else if (
      url.protocol === 'http:' ||
      httpData.redirects.some((hop) => new URL(hop.url).protocol === 'http:')
    )
      add('warning', 'http_insecure_hop', 'The request or a redirect used unencrypted HTTP.');
    if (httpData.status >= 400)
      add('warning', 'http_error_status', 'The endpoint returned an HTTP error status.');
    securityHeaders = Object.fromEntries(
      Object.entries(headerNames).map(([key, name]) => {
        const value = httpData.securityHeaders[name] ?? null;
        return [
          key,
          {
            present: Boolean(value?.trim()),
            value,
            applicable: key !== 'strictTransportSecurity' || httpData.https,
          },
        ];
      }),
    ) as SiteAuditSecurityHeaders;
    const checks: Array<[keyof SiteAuditSecurityHeaders, string, SiteAuditIssue['severity']]> = [
      ['strictTransportSecurity', 'missing_hsts', 'warning'],
      ['contentSecurityPolicy', 'missing_csp', 'warning'],
      ['xContentTypeOptions', 'missing_x_content_type_options', 'warning'],
      ['xFrameOptions', 'missing_frame_protection', 'warning'],
      ['referrerPolicy', 'missing_referrer_policy', 'info'],
      ['permissionsPolicy', 'missing_permissions_policy', 'info'],
    ];
    for (const [key, code, severity] of checks) {
      if (
        key === 'xFrameOptions' &&
        /(?:^|;)\s*frame-ancestors\s+[^;]+/i.test(securityHeaders.contentSecurityPolicy.value ?? '')
      )
        continue;
      if (securityHeaders[key].applicable && !securityHeaders[key].present)
        add(
          severity,
          code,
          `${headerNames[key]} is absent; consider this recommended protection where appropriate.`,
        );
    }
  }
  return {
    target: url.href,
    hostname: url.hostname,
    dns: { records, failedRecordTypes },
    tls: tlsData,
    http: httpData,
    securityHeaders,
    issues,
    score: scoreSiteAudit(issues),
  };
}

export function createSiteAudit(deps: SiteAuditDependencies = {}) {
  return defineTool({
    name: 'site_audit',
    displayName: 'Site Audit',
    priceSats: 5,
    description: 'Run a combined DNS, TLS, HTTP, and security-header audit of a public website.',
    longDescription:
      'Run a combined DNS, TLS, HTTP, and security-header audit of a public website. LiveAuth meters each call at 5 sats. The score is informational, not a formal security certification.',
    inputSchema: siteAuditInput,
    docs: { category: 'Combined audit', examples: [{ target: 'https://example.com' }] },
    handler: async (input, context) => ({ data: await auditSite(input, context, deps) }),
  });
}
