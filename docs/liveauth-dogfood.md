# LiveAuth dogfooding notes

Observed while integrating strictly as an unrelated third-party customer through public docs and `@liveauth-labs/mcp-server`. No internal LiveAuth material was consulted.

### LA-DOGFOOD-001 — Environment variable naming is inconsistent

**Task:** Configure the public gate in a hosted third-party MCP server.

**Expected:** One canonical variable name and copyable hosted-server example.

**Actual:** The CLI quick start documents `LIVEAUTH_API_KEY`/`LIVEAUTH_API_BASE`; the paid-tool SDK example uses `LIVEAUTH_PUBLIC_KEY`/`LIVEAUTH_API_URL`. The distinction is not explicit.

**Workaround:** InvokeWorks owns `LIVEAUTH_PUBLIC_KEY`/`LIVEAUTH_API_URL` and maps them to `createMcpGate({ publicKey, baseUrl })`.

**Suggested LiveAuth improvement:** Split configuration documentation into “bundled CLI” and “embedded SDK,” explaining why names differ.

### LA-DOGFOOD-002 — No MCP TypeScript SDK v2 integration recipe

**Task:** Charge calls inside MCP 2026-07-28 `createMcpHandler()` while supporting its legacy fallback.

**Expected:** Token extraction, per-request factories, idempotency, and receipt projection guidance.

**Actual:** Examples are transport-neutral and do not show `@modelcontextprotocol/server` v2 or result receipt placement.

**Workaround:** Capture bearer token and stable `X-Request-Id` from public request context, call an isolated gate adapter, and return the charge object in result `_meta`.

**Suggested LiveAuth improvement:** Add a tested v2 recipe covering both current and supported legacy HTTP clients.

### LA-DOGFOOD-003 — Tool registration automation is underspecified

**Task:** Register stable tool slugs/prices repeatably across environments.

**Expected:** A public API or CLI with idempotent create/update/list examples.

**Actual:** Docs explain attribution by registered `toolId`/`toolName`, but reviewed public material does not show an end-to-end automated registration workflow.

**Workaround:** Keep canonical slugs/prices in the registry and document one-time portal work. No inferred endpoint is used.

**Suggested LiveAuth improvement:** Document a public registration API/CLI, or clearly identify portal-only fields.

### LA-DOGFOOD-004 — Embedded-gate test support is unclear

**Task:** Automate server integration tests without production charges.

**Expected:** Documented test-mode gate or sandbox fixtures for expired tokens, budget denial, replay, and receipts.

**Actual:** Demo mode is documented for the bundled stdio server, not clearly for embedded `createMcpGate`.

**Workaround:** Tests inject a contract-faithful gate at the package boundary. Real paid tests remain opt-in; production never emulates LiveAuth.

**Suggested LiveAuth improvement:** Provide a sandbox or public test adapter covering validation, denial, idempotency, and receipts.
