# Context Map

Turborepo monorepo. Each workspace below has its own `CONTEXT.md`.

## Apps

- [Server](./apps/server/CONTEXT.md) — Bun runtime; HTTP + WebSocket via ORPC.
- [Web](./apps/web/CONTEXT.md) — React SPA.

## Packages

- [API](./packages/api/CONTEXT.md) — ORPC router and procedures.
- [Auth](./packages/auth/CONTEXT.md) — Better Auth.
- [DB](./packages/db/CONTEXT.md) — Drizzle + libSQL.
- [Env](./packages/env/CONTEXT.md) — Zod-validated env vars.
- [UI](./packages/ui/CONTEXT.md) — Shared React components.
- [Config](./packages/config/CONTEXT.md) — Shared TypeScript config.

## Tools

- [DTLN engine build](./tools/dtln/README.md) — Docker-pinned build of the vendored
  noise-suppression wasm artifact (not a workspace; see
  [ADR 0010](./docs/adr/0010-vendored-dtln-noise-suppression.md)).
