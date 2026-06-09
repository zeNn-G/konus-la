# API

ORPC router and procedures. The `appRouter` is the typed contract between server and web.

## Language

- **Procedure** — a typed RPC operation (input schema → handler → output).
- **Public Procedure** — no auth required.
- **Protected Procedure** — requires an authenticated session; the auth middleware exposes `session` + `user` to the handler.
- **Admin Procedure** — builds on Protected; additionally requires the global `admin` role (the Instance Owner, ADR 0002).
- **Context** — per-request value passed to every procedure handler. Carries `{ headers }`; the Better Auth session is resolved **lazily** inside the auth middleware (so public procedures skip `getSession`), following the oRPC × Better Auth integration pattern.
- **Routers** — `signupCode` (create / list / revoke, admin-only) and `profile` (update displayName) alongside `healthCheck`.
- **Publisher** — process-lifetime in-memory event bus (`MemoryPublisher<EventMap>` from `@orpc/experimental-publisher`). Singleton at `src/realtime/publisher.ts`. Procedures emit; ORPC event-iterator procedures subscribe.
- **EventMap** — typed record of all realtime events the publisher carries (empty in Phase 0).
