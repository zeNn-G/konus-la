# Server

Bun runtime (`Bun.serve`). Dispatches by URL path:

- `/ws` — WebSocket upgrade for ORPC over WS (`@orpc/server/bun-ws`).
- `/api/auth/*` — Better Auth handler.
- `/rpc/*` — ORPC HTTP `RPCHandler`.
- `/` — health probe.

Both ORPC handlers carry the pino `LoggingHandlerPlugin`; the HTTP handler also carries `CORSPlugin`. The ORPC `CORSPlugin` only covers `/rpc`, so `/api/auth/*` gets CORS handled inline in `fetch` — an `OPTIONS` preflight responder plus CORS headers on each response, with `x-signup-code` in the allowed headers (the signup-code header forces a browser preflight). Logger configured in `src/logger.ts` — `pino-pretty` in dev, JSON in prod.
