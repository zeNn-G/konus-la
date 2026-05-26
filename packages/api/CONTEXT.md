# API

ORPC router and procedures. The `appRouter` is the typed contract between server and web.

## Language

- **Procedure** — a typed RPC operation (input schema → handler → output).
- **Public Procedure** — no auth required.
- **Protected Procedure** — requires an authenticated session.
- **Context** — per-request value passed to every procedure handler.
