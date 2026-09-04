# Contributing

Open an issue before a large change. Keep tools focused, transport-independent, and deterministic under test.

Use Node.js 22+ and pnpm 10. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. New network tools need explicit SSRF analysis and tests. Never include credentials or private LiveAuth material.
