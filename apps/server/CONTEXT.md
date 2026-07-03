# Server

Bun runtime (`Bun.serve`). Dispatches by URL path:

- `/ws` — WebSocket upgrade for ORPC over WS (`@orpc/server/bun-ws`). **Authenticated at upgrade**: Origin check (CSWSH guard) → Better Auth session from the cookie → 401 before upgrading. `{ userId, headers }` is stashed as `ws.data`; the upgrade headers become the per-message ORPC context so `requireAuth` works unchanged over WS. Socket `open`/`close` drive presence (`presenceConnectionOpened/Closed` from `@konus-la/api`).
- `/api/auth/*` — Better Auth handler.
- `/rpc/*` — ORPC HTTP `RPCHandler`.
- `/` — health probe.

Dev note: `bun --hot` only watches files inside `apps/server` — edits under `packages/*` need a server restart (and reset in-memory state: presence map, rate-limit windows, publisher retention buffer).

Both ORPC handlers carry the pino `LoggingHandlerPlugin`; the HTTP handler also carries `CORSPlugin`. The ORPC `CORSPlugin` only covers `/rpc`, so `/api/auth/*` gets CORS handled inline in `fetch` — an `OPTIONS` preflight responder plus CORS headers on each response, with `x-signup-code` in the allowed headers (the signup-code header forces a browser preflight). Logger configured in `src/logger.ts` — `pino-pretty` in dev, JSON in prod.
