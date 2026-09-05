# LiveAuth dogfooding notes

Findings 001–004 were observed while integrating strictly as an unrelated third-party customer through public docs and `@liveauth-labs/mcp-server`, without internal LiveAuth material. Finding 005 includes a subsequent source-level investigation and read-only verification in the LiveAuth console.

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


### LA-DOGFOOD-005 — MCP SDK hashes an API-key alias instead of the canonical project key

**Observed:** September 4–5, 2026, using the published `@liveauth-labs/mcp-server@1.1.1` from `/Users/scott/invokeworks-smoke` against `https://api.liveauth.app`. `start()` succeeds, but automatic `confirm()` returns HTTP 401 with `LiveAuth MCP returned non-JSON response: Hash mismatch`.

**Proven identity:** The LiveAuth console identifies InvokeWorks as project `992d4df5-b469-44f2-95db-0b739d972cc1`, with primary public key `la_pk_M-LSoRpQKfseG-5SGps4xL_4`. Its API Keys page lists `la_pk_N9mKdQio51koSH51SOkN96Am` as the active `smoke-test` key for that same project. These are two keys belonging to one project.

**Root cause:** `ApiKeyService.AuthenticatePublicKeyAsync` accepts an active `ProjectApiKey.PublicKey` and resolves its owning `Project`. The MCP controller creates and verifies PoW using that project's canonical `Project.PublicKey`. The SDK's `LiveAuthMcpClient.solvePow()` instead overrides the challenge key with its configured API public key. This changes the SHA-256 preimage and produces `Hash mismatch`. The browser SDK and CLI already solve using the challenge key.

**Evidence:** Four direct-fetch starts and three SDK starts returned the same correct project ID and canonical key, with seven distinct quote IDs and challenge hex values. Both automatic confirmation and explicit configured-key solving failed with HTTP 401. Explicit solving with `challenge.projectPublicKey` succeeded through `confirm({powSolution})`; a deliberately invalid hash was rejected. The returned JWT contained `projectId=992d4df5-b469-44f2-95db-0b739d972cc1`, `authType=mcp_pow`, and the matching `mcpQuoteId`; it did not contain a `projectPublicKey` claim. A subsequent authenticated usage request returned `active`. No JWT or refresh token was logged.

**Expected behavior and fix:** Keep the configured API key in `X-LW-Public`, and solve with `solvePow(session.powChallenge)`. This source change passed the production default flow with the original configured key. Rejecting unequal public-key strings would break valid aliases; project isolation is enforced by the server's resolved project ID, signed challenge, and quote lookup. No cross-project issuance was observed in this investigation.

**Regression coverage:** New SDK cases cover primary keys, aliases, unchanged request headers, and invalid-solution rejection. New server tests execute the real public-key middleware and cover canonical PoW, signature-validated JWT project claims, invalid hashes, foreign-project quotes/challenges, fresh sessions/replay, and Lightning/L402 alias-session binding. The SDK suite passed 47 tests and its TypeScript build; 45 relevant server tests passed with a successful .NET build (existing warnings).

**Release impact:** Publish a fixed MCP npm version newer than 1.1.1. No LiveAuth runtime server change or deployment is required for this PoW fix. InvokeWorks requires no application-code workaround or configured-key change; consumers performing SDK client authentication should update the package once released.

**Documentation/API improvements:** The SDK README now distinguishes authentication keys from canonical PoW keys and explains project-ID checks. The console displays this project as TEST; source inspection also shows primary-key resolution checks LIVE/AllowDemoAuth while the API-key alias path checks active status without that environment condition. This separate policy asymmetry should be documented/reviewed, but was not changed in this fix. The plain-text `Hash mismatch` response also obscures the authentication error behind the SDK's non-JSON message; a structured API error would improve diagnostics.
