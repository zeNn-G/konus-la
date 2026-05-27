# API

ORPC router and procedures. The `appRouter` is the typed contract between server and web.

## Language

- **Procedure** — a typed RPC operation (input schema → handler → output).
- **Public Procedure** — no auth required.
- **Protected Procedure** — requires an authenticated session.
- **Context** — per-request value passed to every procedure handler. Currently `{ session }`.
- **Publisher** — process-lifetime in-memory event bus (`MemoryPublisher<EventMap>` from `@orpc/experimental-publisher`). Singleton at `src/realtime/publisher.ts`. Procedures emit; ORPC event-iterator procedures subscribe.
- **EventMap** — typed record of all realtime events the publisher carries (empty in Phase 0).
