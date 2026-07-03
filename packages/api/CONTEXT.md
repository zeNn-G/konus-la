# API

ORPC router and procedures. The `appRouter` is the typed contract between server and web.

## Language

- **Procedure** — a typed RPC operation (input schema → handler → output).
- **Public Procedure** — no auth required.
- **Protected Procedure** — requires an authenticated session; the auth middleware exposes `session` + `user` to the handler.
- **Admin Procedure** — builds on Protected; additionally requires the global `admin` role (the Instance Owner, ADR 0002).
- **Guild Member / Guild Owner middleware** — the per-guild access tier (`requireGuildMember` / `requireGuildOwner`; see [ADR 0004](../../docs/adr/0004-per-guild-authorization-custom-rbac-tables.md)). They gate on a `guildId` from **validated input**, so they are chained **after** `.input()` rather than baked into a base procedure: `protectedProcedure.input(...).use(requireGuildOwner)`. Member = belongs to the guild (also drives no-peek); Owner = `guild.ownerId`.
- **Channel Member middleware** — `requireChannelMember`, for procedures keyed by `channelId`: loads the channel, requires guild membership, injects the loaded `channel` (non-null `guildId`) into context so handlers don't re-query. Rejects DM channels until Phase 4.
- **Ratelimit middleware** — `perUserRatelimit(rule, limiter)` in `src/ratelimit.ts` (`@orpc/experimental-ratelimit`, in-memory sliding windows, keyed `rule:userId`, throws TOO_MANY_REQUESTS). Rules: sendMessage 30/10s, markRead 60/min, typing 1/s, inviteCreate 5/hr.
- **Context** — per-request value passed to every procedure handler. Carries `{ headers }`; the Better Auth session is resolved **lazily** inside the auth middleware (so public procedures skip `getSession`), following the oRPC × Better Auth integration pattern.
- **Routers** — `signupCode` (create / list / revoke, admin-only), `profile` (update displayName), `guild` (`create` / `list` / `get` / `transferOwnership` / `delete`, nested `guild.invite` + `guild.member`), `channel` (create / update / delete / list / markRead), `chat` (sendMessage / editMessage / deleteMessage / history), `typing` (start), `realtime` (events), alongside `healthCheck`.
- **Publisher** — process-lifetime in-memory event bus (`MemoryPublisher<EventMap>`, `resumeRetentionSeconds: 120` for `lastEventId` resume). Singleton at `src/realtime/publisher.ts`. Mutations fan out via **`publishTo(userIds, event)`** (`src/realtime/publishers.ts`) to per-user topics; the `realtime.events` iterator subscribes to the caller's own topic. See [ADR 0005](../../docs/adr/0005-per-user-topic-realtime-hybrid-transport.md).
- **RealtimeEvent / EventMap** — the discriminated union of server→client events and its `user:{userId}` topic map (`src/realtime/events.ts`). Adding a realtime feature = add a union variant, compute recipients, `publishTo`.
- **Presence** — in-memory open-socket counts + 5 s debounced offline broadcast (`src/realtime/presence.ts`). Lives here (not `apps/server`) because the events iterator reads the snapshot synchronously at subscribe; the server's socket hooks call `presenceConnectionOpened/Closed`.
