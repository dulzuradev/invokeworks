// Shared, illustrative examples for the public site. No network calls are made here.
export const auditInput = { target: 'https://example.com' };
export const auditOutput = {
  hostname: 'example.com',
  score: 95,
  issues: [
    {
      severity: 'warning',
      code: 'missing_csp',
      message:
        'content-security-policy is absent; consider this recommended protection where appropriate.',
    },
  ],
};
export const mcpExample = `import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const jwt = process.env.LIVEAUTH_JWT;
if (!jwt) throw new Error('Set LIVEAUTH_JWT to an active InvokeWorks MCP session token');

// One ID per logical call. Keep this ID and the arguments unchanged on a retry.
const requestId = crypto.randomUUID();
const client = new Client({ name: 'site-audit-client', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(
  new URL('https://mcp.invokeworks.dev/mcp'),
  { requestInit: { headers: {
    Authorization: \`Bearer \${jwt}\`,
    'X-Request-Id': requestId,
  } } },
);

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: 'site_audit',
    arguments: { target: 'https://example.com' },
  });
  console.log(result); // Audit result plus _meta.liveauth billing metadata / receipt.
} finally {
  await client.close();
}`;
