# Web

Vite + React 19 SPA. File-based routing via TanStack Router, server state via TanStack Query, RPC calls via the ORPC client.

## Route structure

Routes are organised into pathless groups under `src/routes/` (group names don't affect URLs):

- **`(auth)/`** — public pages with no app shell: `login`, `signup`.
- **`(app)/`** — the authenticated area. `(app)/route.tsx` is a layout that guards every child once
  (`beforeLoad` → `requireSession`) and renders the shared shell: a top header (+ `UserCard`) over a
  persistent left **guild rail** + main content. Its resolved session flows into child route context.
  - **`(app)/admin/`** — nested layout that adds the Instance-Owner gate (`requireAdmin`) for `/admin/*`.
  - **`(app)/guilds/$guildId/`** — a guild. `route.tsx` is the guild layout: a **channel sidebar**
    (`components/channel-sidebar.tsx` — unread bold + red mention badge, owner-only create/rename/delete via
    `components/channel-name-dialog.tsx`) beside the outlet. `index.tsx` is the roster view (with presence
    dots), `settings.tsx` the owner-only management page, and `channels/$channelId.tsx` the chat view.
    Owner-gating is data-driven (`guild.get` → `viewer.isOwner`), not a route guard — the API is the source
    of truth.

The **guild rail** (`components/guild-rail.tsx`) lists the user's guilds from `guild.list` plus a home entry
and an **add-guild** trigger (`components/add-guild-dialog.tsx` — a Tabs dialog to create or join by code).
Mutations refetch via TanStack Query invalidation of `guild.list`.

## Realtime

`lib/use-realtime.ts` owns the live layer (see [ADR 0005](../../docs/adr/0005-per-user-topic-realtime-hybrid-transport.md)):

- **`useRealtime(selfUserId)`** — mounted ONCE in the `(app)` layout. Opens one reconnecting WebSocket
  (`partysocket/ws` + `@orpc/client/websocket`) whose only job is the `realtime.events` iterator; every
  event runs through a single dispatcher switch — `setQueryData` for messages/typing/presence/read-state,
  `invalidateQueries` for structural `channel.*` events. On every reconnect it invalidates ALL queries
  (missed-events gaps beyond the server's 2-min resume retention are silent).
- **Key discipline**: the channel view and the dispatcher MUST build history keys through
  `historyInfiniteOptions` / `historyInfiniteKey` — a hand-built key silently misses the cache.
- **Typing / presence** live in plain client-only query keys (`["realtime", ...]`) read via
  `useTypingEntries` / `usePresence`; no fetcher behind them.
- **Chat components** (`components/chat/`): `message-list` (infinite scroll, pinned-to-bottom, no
  virtualization), `message-item` (hover reply/edit/delete; cache updates come from the author's own
  realtime events, never from mutation handlers), `message-markdown` (react-markdown + GFM, mention pills),
  `composer` (raw-markdown textarea, Enter sends, `@` autocomplete, 4 s typing throttle), `typing-line`.
- **markRead** fires whenever the viewed channel's newest message changes while the window is focused —
  including the viewer's own messages, otherwise a later refetch resurrects a phantom unread. The caller tab
  patches its own sidebar cache in `onSuccess`; other tabs get the `readState.updated` event.

Guards live on the **layouts**, not individual pages — so a page like `profile` or `admin/codes` has no
`beforeLoad`; it inherits the session from its parent layout's context.

## Auth & session

- `lib/auth-client.ts` — Better Auth React client, typed with `inferAdditionalFields<typeof auth>()`
  (for `username`) and `adminClient()` (for `role` / `banned`).
- `lib/auth-guard.ts` — `requireSession` / `requireAdmin` call `authClient.getSession()` **directly** in
  layout `beforeLoad`. There is deliberately **no client-side session cache**: TanStack Router's match
  caching de-dupes hover preloads, and a live `getSession` per navigation keeps auth transitions correct
  (a cached session went stale across sign-in/out).
- Components read the session from route context: route components via `Route.useRouteContext()`, other
  components (e.g. `UserCard`) via `getRouteApi("/(app)").useRouteContext()`. After a profile edit, call
  `router.invalidate()` to re-run the layout guard and refresh context.
- Sign in / up / out use Better Auth's `onSuccess` / `onError` callbacks to navigate + toast — no manual
  cache work. The signup code is sent as the `x-signup-code` request header.

## Forms

Auth forms use **TanStack Form** (`@tanstack/react-form`) with zod `validators.onSubmit`. Field errors render
through the shared `components/field-error.tsx`.
