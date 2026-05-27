# Server

Bun runtime (`Bun.serve`). Dispatches by URL path:

- `/ws` — WebSocket upgrade for ORPC over WS (`@orpc/server/bun-ws`).
- `/api/auth/*` — Better Auth handler.
- `/rpc/*` — ORPC HTTP `RPCHandler`.
- `/` — health probe.

Both ORPC handlers carry the pino `LoggingHandlerPlugin`; the HTTP handler also carries `CORSPlugin`. Logger configured in `src/logger.ts` — `pino-pretty` in dev, JSON in prod.
