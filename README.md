# InvokeWorks

Useful tools for autonomous agents.

InvokeWorks is an open-source, publicly hosted collection of focused MCP tools. It separates tool logic from MCP transport and delegates authentication, budgets, metering, per-tool charges, and signed receipts to LiveAuth through its public SDK.

- Website: <https://invokeworks.dev>
- MCP endpoint: <https://mcp.invokeworks.dev/mcp>
- Health: <https://mcp.invokeworks.dev/health>

## Tools

| Tool           | Purpose                                                             |  Price |
| -------------- | ------------------------------------------------------------------- | -----: |
| `dns_lookup`   | A, AAAA, CNAME, MX, TXT, NS, and SOA queries                        |  1 sat |
| `http_inspect` | HTTP status, redirects, headers, size, timing, and security headers | 2 sats |
| `tls_inspect`  | TLS protocol, cipher, certificate, SANs, validity, and chain        | 2 sats |

## Architecture

- `apps/server`: Hono/Node service using MCP SDK v2 `createMcpHandler()`, with modern stateless 2026-07-28 and SDK-supported 2025-era compatibility.
- `apps/web`: static Astro site.
- `packages/tools`: transport-independent tools and shared catalog registry.
- `packages/liveauth`: the only package importing the public `@liveauth-labs/mcp-server` SDK.
- `packages/shared`: environment and request utilities.
- `tests/integration`: official MCP client → server → LiveAuth adapter → tool tests.

There is no database, InvokeWorks account system, wallet, or billing implementation.

## Local development

Requires Node.js 22+ and pnpm 10.

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

The server listens at `http://localhost:3000/mcp`; health is `/health`. Run the website with `pnpm dev:web`.

For local transport testing without a LiveAuth account, set `NODE_ENV=test` and `LIVEAUTH_BYPASS_FOR_TESTS=true`; only the literal token `test-token` is accepted. This configuration is rejected in production.

## Configuration

| Variable              | Required   | Description                             |
| --------------------- | ---------- | --------------------------------------- |
| `LIVEAUTH_PUBLIC_KEY` | Production | LiveAuth project public key (`la_pk_…`) |
| `LIVEAUTH_API_URL`    | No         | Defaults to `https://api.liveauth.app`  |
| `HOST` / `PORT`       | No         | Defaults to `0.0.0.0:3000`              |
| `LOG_LEVEL`           | No         | Structured log level                    |

Never commit `.env` or tokens. Clients send `Authorization: Bearer <LiveAuth JWT>`. Supply a stable, unique `X-Request-Id` on retries; it becomes the LiveAuth idempotency key. Signed receipts are returned under MCP result `_meta.liveauth`.

## Adding a tool

1. Create a module in `packages/tools/src`.
2. Call `defineTool()` with one Zod v4 schema, stable name, descriptions, sat price, examples, and handler.
3. Inject external I/O behind a narrow interface.
4. Add it to `tools` in `packages/tools/src/index.ts`.
5. Add handler and security tests.

The MCP server and Astro catalog consume the registry automatically. Handlers return `{ data }` and know nothing about MCP or LiveAuth.

## Validation

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

Integration tests use the official MCP Streamable HTTP client. Real LiveAuth production calls are separate and opt-in because they require a customer project and funded test session.

## Security model

`http_inspect` accepts only HTTP(S), rejects URL credentials, resolves every address, rejects any non-public answer, pins a validated address into the connection, and validates redirects afresh. Redirects, response bytes, and time are capped; caller headers are never forwarded. `tls_inspect` applies the same destination policy and pinning. MCP bodies are capped at 64 KiB. Logs omit authorization data.

Deploy behind TLS with public Host allowlisting, concurrency/rate limits, and upstream timeouts. LiveAuth remains authoritative for session budgets and charging. See [SECURITY.md](SECURITY.md).

## Docker and deployment

```sh
docker build -f apps/server/Dockerfile -t invokeworks-mcp .
docker run --rm -p 3000:3000 --env-file .env invokeworks-mcp
```

Route `mcp.invokeworks.dev` to port 3000 and preserve `Authorization`, `MCP-Protocol-Version`, `Accept`, and `X-Request-Id`. Serve `apps/web/dist` statically for `invokeworks.dev`. No hosting provider is assumed.

## LiveAuth portal setup

Using ordinary customer-facing functionality only:

1. Create a LiveAuth project and obtain its public key.
2. Register `dns_lookup`, `http_inspect`, and `tls_inspect` at 1, 2, and 2 sats.
3. Configure budgets/rate limits and Lightning settlement in LiveAuth.
4. Set the public key in the server environment and run an opt-in real charge/receipt test.

The adapter passes explicit prices, but portal values should match. See [docs/liveauth-dogfood.md](docs/liveauth-dogfood.md).

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md). InvokeWorks is available under the [MIT License](LICENSE).
