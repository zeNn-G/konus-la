# Realtime: per-user topics over one event iterator, hybrid transport

Phase 3's realtime layer delivers every server→client event on the recipient's own
**`user:{userId}` topic** through **one `realtime.events` event-iterator per WS connection**,
and the client keeps a **hybrid transport**: the existing fetch `RPCLink` for all
queries/mutations, one WebSocket used _only_ for the event stream (and, by socket lifecycle,
presence).

## Context

The ROADMAP's "Realtime transport" section said _single transport: ORPC over WebSocket_ for
everything. This ADR amends that (ROADMAP is direction, not contract) and settles how events
are scoped. The alternatives considered:

- **Per-resource topics** (`chat:{channelId}`, `guild:{guildId}`) with the subscription merging
  N topics at subscribe time. Rejected: a membership change mid-connection leaves the merged
  iterator stale, forcing a resubscribe protocol. With per-user topics the recipient set is
  computed fresh **at publish time** (`publishTo(userIds, event)` in
  `packages/api/src/realtime/publishers.ts`), so joins/kicks need nothing.
- **All-WS transport** (move the whole client onto `@orpc/client/websocket`). Rejected for
  Phase 3: it re-plumbs the entire working Phase 1–2 surface, makes page loads block on socket
  readiness, and downgrades mutations from per-request session validation to upgrade-time-only
  auth. Phase 5 (mediasoup signaling) may still route `voice.*` calls over the same socket —
  that decision is deferred, not foreclosed.

Sharkord (the closest production precedent, same Bun + self-hosted shape) independently landed
on per-user targeted publish (`publishFor(userIds, event)`) with recipient sets computed
server-side per event; we adopt that, minus its one-subscription-per-event-type layout — oRPC's
dynamic topic names let a single iterator carry a discriminated `RealtimeEvent` union instead.

Load-bearing details:

- **Fan-out cost is accepted**: a message to an N-member guild is N in-process publishes.
  Publishing to a user with no subscription is a no-op on `MemoryPublisher`, so recipients are
  NOT filtered by online status. A future Redis publisher would want guild-level topics; that
  is the known trade.
- **WS auth at upgrade** (Better Auth session cookie, `SameSite=Lax`, Origin-checked), stashed
  as `ws.data` with the upgrade headers so `requireAuth` re-validates per procedure call —
  including at subscription start. Presence is derived from socket open/close counts with a 5 s
  offline debounce (`packages/api/src/realtime/presence.ts` — lives in the api package because
  the subscription reads the snapshot synchronously).
- **Resume + conservative fallback**: `MemoryPublisher({ resumeRetentionSeconds: 120 })` replays
  a reconnect gap via `lastEventId`; a gap older than retention is **silent**, so the client
  invalidates all queries on every reconnect (`useRealtime` in
  `apps/web/src/lib/use-realtime.ts`).
- The subscription's first yield is a `presence.snapshot` (no event meta → doesn't disturb
  resume ids), eliminating the fetch-vs-subscribe race for initial presence.

## Consequences

- Every new realtime feature is: add a variant to `RealtimeEvent`
  (`packages/api/src/realtime/events.ts`), compute recipients, `publishTo(...)`, add a
  dispatcher case in `useRealtime`. No subscription plumbing changes, ever.
- The client dispatcher is a single exhaustive switch feeding TanStack Query caches —
  `setQueryData` for high-frequency events, `invalidateQueries` for structural ones (the
  ROADMAP's hybrid reconciliation).
- Two auth paths exist (per-request cookie for fetch RPC, upgrade-time + per-call for WS); both
  ride the same Better Auth session cookie. If web and API ever split across different
  registrable domains, WS cookie auth breaks — the Origin check and same-site deploy are the
  standing assumptions.
- oRPC packages must stay version-aligned across the workspace: `@orpc/experimental-ratelimit`
  pins exact `@orpc/server` versions, and two physical copies of `@orpc/server` break
  `instanceof ORPCError` (defined errors surface as 500s). Catalog + experimental deps are
  pinned to the same minor for this reason.
