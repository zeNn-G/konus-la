# API

ORPC router and procedures. The `appRouter` is the typed contract between server and web.

## Language

- **Procedure** — a typed RPC operation (input schema → handler → output).
- **Public Procedure** — no auth required.
- **Protected Procedure** — requires an authenticated session; the auth middleware exposes `session` + `user` to the handler.
- **Admin Procedure** — builds on Protected; additionally requires the global `admin` role (the Instance Owner, ADR 0002).
- **Guild Member / Guild Owner middleware** — the per-guild access tier (`requireGuildMember` / `requireGuildOwner`; see [ADR 0004](../../docs/adr/0004-per-guild-authorization-custom-rbac-tables.md)). They gate on a `guildId` from **validated input**, so they are chained **after** `.input()` rather than baked into a base procedure: `protectedProcedure.input(...).use(requireGuildOwner)`. Member = belongs to the guild (also drives no-peek); Owner = `guild.ownerId`.
- **Context** — per-request value passed to every procedure handler. Carries `{ headers }`; the Better Auth session is resolved **lazily** inside the auth middleware (so public procedures skip `getSession`), following the oRPC × Better Auth integration pattern.
- **Routers** — `signupCode` (create / list / revoke, admin-only), `profile` (update displayName), and `guild` alongside `healthCheck`. The `guild` router: `create` / `list` / `get` / `transferOwnership` / `delete`, plus nested `guild.invite` (create / consume / list / revoke) and `guild.member` (kick / ban / unban / banList / leave).
- **Publisher** — process-lifetime in-memory event bus (`MemoryPublisher<EventMap>` from `@orpc/experimental-publisher`). Singleton at `src/realtime/publisher.ts`. Procedures emit; ORPC event-iterator procedures subscribe.
- **EventMap** — typed record of all realtime events the publisher carries (empty in Phase 0).
