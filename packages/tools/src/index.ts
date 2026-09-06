export * from './types.js';
export * from './network.js';
export * from './dns.js';
export * from './http.js';
export * from './tls.js';
export * from './site-audit.js';

import { createDnsLookup } from './dns.js';
import { createHttpInspect } from './http.js';
import { createSiteAudit } from './site-audit.js';
import { createTlsInspect } from './tls.js';
import type { ToolDefinition } from './types.js';

export const tools = [
  createDnsLookup(),
  createHttpInspect(),
  createTlsInspect(),
  createSiteAudit(),
] as unknown as ToolDefinition[];
export const toolCatalog = tools.map(
  ({ name, displayName, description, longDescription, priceSats, docs }) => ({
    name,
    displayName,
    description,
    longDescription,
    priceSats,
    docs,
  }),
);
