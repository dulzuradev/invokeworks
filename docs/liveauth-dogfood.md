# LiveAuth dogfooding notes

**Current integration:** InvokeWorks consumes `@liveauth-labs/mcp-server ^1.2.0`.
The operator reports `site_audit` is live and registered at 5 sats, with production
PoW authentication, successful execution, receipts, and same-request-ID billing
idempotency verified. One call increments `callsUsed` by 1 and `satsUsed` by 5;
remaining budget decreases by 5. The observations below retain the SDK versions
used at the time; they are historical diagnostics, not current setup instructions.

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

**Historical release recommendation (now superseded by SDK ^1.2.0 consumption):** Publish a fixed MCP npm version newer than 1.1.1. No LiveAuth runtime server change or deployment is required for this PoW fix. InvokeWorks requires no application-code workaround or configured-key change; consumers performing SDK client authentication should update the package once released.

**Documentation/API improvements:** The SDK README now distinguishes authentication keys from canonical PoW keys and explains project-ID checks. The console displays this project as TEST; source inspection also shows primary-key resolution checks LIVE/AllowDemoAuth while the API-key alias path checks active status without that environment condition. This separate policy asymmetry should be documented/reviewed, but was not changed in this fix. The plain-text `Hash mismatch` response also obscures the authentication error behind the SDK's non-JSON message; a structured API error would improve diagnostics.

### LA-DOGFOOD-006 — Tool availability denial is presented as budget exhaustion

**Status: source fix shipped in SDK 1.2.0, now consumed by InvokeWorks.**
SDK 1.2.0 adds `ChargeDeniedError.reason`; backend unknown-tool responses are JSON
and Draft tools return `tool_unpublished`. InvokeWorks exposes known denial reasons
in `_meta.liveauth`. Existing 1.1.x structured denial details are also supported.
See [integration contract](liveauth-contract.md). The historical denial scenario below has not been independently retested in this documentation update.

**Observed:** During production smoke testing with published `@liveauth-labs/mcp-server@1.1.2`, PoW and session validation passed and the session had 10,000 sats of remaining allowance. One direct `gate.charge(jwt, 1, ...)` for `dns_lookup` returned `status=deny`, `ok=false`, and `reason=tool_inactive`, with no usage increase. The SDK's `gate.invoke()`/`gateTool()` reports any unsuccessful charge as `LiveAuth MCP budget denied this tool call`, obscuring the actual reason. The operator subsequently reported publishing/activating the tool, and the completion run verified successful one-sat DNS calls. The operator also reported earlier `Unknown MCP tool` responses; those were not independently captured in this investigation.

**Expected:** Tool registration/discovery and tool availability are distinct. Surface the structured `tool_inactive` reason already returned by LiveAuth rather than describing every denial as exhausted budget. Document publish/active prerequisites, and consistently return structured tool-availability errors (for example `tool_not_published`, `tool_inactive`, or `tool_not_available`) where applicable.

**Scope:** No production configuration was changed during the diagnostics or completion run. The observed inactive-tool denial does not establish a session-budget failure.

### LA-DOGFOOD-007 — MCP correlation IDs and receipt request IDs have different meanings

**Status: resolved in documentation and regression tests.** Public receipt field names
are unchanged. SDK type comments and the [integration contract](liveauth-contract.md)
distinguish server request IDs, stable retry keys, and InvokeWorks correlation IDs.

**Observed:** Production responses preserve the client's `X-Request-Id` in `result._meta.requestId` and use the same value as `result._meta.liveauth.receipt.body.idempotencyKey`. The receipt's `body.requestId` is a separate upstream identifier. For example, the completion run preserved `smoke-2d3af3d6-cb9c-4876-8803-0c48ed65c9e3` in the MCP response and receipt idempotency key, while the receipt request ID was `0HNNVM30K3F25:00000006`.

**Correction:** The external smoke suite previously searched recursively for `requestId` and incorrectly compared the upstream receipt identifier with the client ID. It now checks the two intended fields explicitly and logs the receipt request ID separately as `liveAuthRequestId`. This was a smoke-test assertion bug, not evidence of a production correlation bug.

**Verified retry behavior:** Two calls with the same JWT, request ID, `dns_lookup` name, and arguments returned the same revenue event `8c8bd5b6-59ab-4c04-a0d0-63595b44b92b`. Session sats used were `0 -> 1 -> 1`, remaining budget `10000 -> 9999 -> 9999`, and both receipt idempotency keys matched the client request ID.

**Suggested improvement:** Document MCP/client correlation IDs, idempotency keys, and upstream/server HTTP request IDs separately, with a receipt example showing all three. Different values for the client and server request IDs are not themselves a bug.

### LA-DOGFOOD-008 — Billed execution failures lose charge metadata

**Historical observation:** A DNS lookup of `smoke-does-not-exist.invalid` failed
with ENOTFOUND after authorization, while calls used and sats used each increased
by one and remaining budget decreased by one. No refund was observed; the MCP
error response exposed only its client request ID.

**Status: source fix available in SDK 1.2.0, now consumed by InvokeWorks.** The documented
policy is that authorization plus accepted execution is billable. SDK 1.2.0 wraps
handler exceptions in `ToolExecutionError` carrying charge metadata and a private
cause. InvokeWorks returns sanitized `_meta.liveauth` on billed failures, including
gross sats, revenue event ID, receipt when present, and idempotency key. Its adapter
also preserves this information with 1.1.x. Local regressions cover the SDK, HTTP
MCP projection, and backend billing/idempotency ledger. No paid production calls
or production configuration changes were made for this fix.
