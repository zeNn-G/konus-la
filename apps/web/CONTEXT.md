# Web

Vite + React 19 SPA. File-based routing via TanStack Router, server state via TanStack Query, RPC calls via the ORPC client.

## Route structure

Routes are organised into pathless groups under `src/routes/` (group names don't affect URLs):

- **`(auth)/`** — public pages with no app shell: `login`, `signup`.
- **`(app)/`** — the authenticated area. `(app)/route.tsx` is a layout that guards every child once
  (`beforeLoad` → `requireSession`) and renders the shared shell: a shadcn `SidebarProvider` with
  `components/app-sidebar.tsx` (nested-rails panel, sidebar-09 shape) beside a `SidebarInset` for the
  page. The panel = the persistent **guild rail** + a second column chosen by `lib/sidebar-zone.ts`:
  DM sidebar in the home zone, channel sidebar inside a guild, none on profile/admin (rail-only).
  Desktop is pinned open (no collapse); on mobile the whole panel is a sheet opened by per-page
  `SidebarTrigger`s and closed on navigation. `UserCard` lives in the second column's footer. The
  layout's resolved session flows into child route context.
  - **`(app)/index.tsx`** — Home IS the DM zone. Desktop: just an empty-state pane (the DM sidebar
    comes from the shell). Mobile: the conversation list itself is the page — `components/dm/dm-list.tsx`
    (`dm.list` rows re-sorted by `lastActivityAt`, unread bold + mention badge), shared with
    `components/dm/dm-sidebar.tsx`, which adds the New DM / New group triggers (`DmActions`).
  - **`(app)/dms/`** — `route.tsx` is a pass-through (the sidebar lives in the shell); `$channelId.tsx` is the
    conversation view (existence + roster from `dm.get`, NEVER `dm.list` — empty 1:1s are filtered
    there; eviction is tombstone-driven — see Realtime below — with a `dm.get` error as the fallback
    redirect for direct URLs or removals missed while offline). fresh
    `dms/new/$userId.tsx` is the **draft view**: no channel exists; the first send runs
    `dm.openWithUser` (idempotent) → `chat.sendMessage` → navigate. `lib/use-message-user.ts` routes
    "Message this user" clicks to the existing 1:1 or the draft. Group management is a header
    members-popover (owner-only remove, add-people search) + kebab (rename / leave) in
    `components/dm/`.
  - **`(app)/admin/`** — nested layout that adds the Instance-Owner gate (`requireAdmin`) for `/admin/*`.
  - **`(app)/guilds/$guildId/`** — a guild. `route.tsx` is a pass-through; the **channel sidebar**
    (`components/channel-sidebar.tsx` — unread bold + red mention badge, owner-only create/rename/delete via
    `components/channel-name-dialog.tsx`) renders from the shell. Its guild-name header is a dropdown:
    "Guild settings" (owner) opens the settings modal, "Leave guild" (non-owner) confirms, then navigates
    home BEFORE invalidating `guild.list` (a refetch from inside the guild would 403). `index.tsx`
    redirects to the first channel (`beforeLoad` + `ensureQueryData(channel.list)`); with zero channels it
    renders a "No channels yet" pane that auto-enters the first channel when realtime delivers one.
    `channels/$channelId.tsx` is the chat view; it also hosts the **members panel**
    (`components/members-panel.tsx` — presence-grouped roster, crown on the owner, per-member popover with
    a Message action): a desktop aside toggled from the header (one global localStorage key, default open)
    and an on-demand right sheet on mobile. **Guild settings** is an owner-only modal
    (`components/guild-settings/` — Members, Bans, Invites, Danger zone; sections mount lazily so
    owner-only queries never fire unselected), not a route.
    Owner-gating is data-driven (`guild.get` → `viewer.isOwner`), not a route guard — the API is the source
    of truth.

The **guild rail** (`components/guild-rail.tsx`) is an icon-only column: a "k" wordmark/home button (active
in the home zone), the user's guilds from `guild.list` (tooltip = guild name), and an **add-guild** trigger
(`components/add-guild-dialog.tsx` — a Tabs dialog to create or join by code). Mutations refetch via
TanStack Query invalidation of `guild.list`.

## Realtime

`lib/use-realtime.ts` owns the live layer (see [ADR 0005](../../docs/adr/0005-per-user-topic-realtime-hybrid-transport.md)):

- **`useRealtime(selfUserId)`** — mounted ONCE in the `(app)` layout. Runs the `realtime.events`
  iterator over the shared `/ws` socket from `lib/ws.ts` (a lazy, never-closed module singleton —
  `partysocket/ws` + `@orpc/client/websocket` — shared with voice signaling, which is
  connection-scoped server-side and must ride the SAME socket as the subscription); every
  event runs through a single dispatcher switch — `setQueryData` for messages/typing/presence/read-state,
  `invalidateQueries` for structural `channel.*` events. On every reconnect it invalidates ALL queries
  (missed-events gaps beyond the server's 2-min resume retention are silent) and notifies
  `voiceSession` that the subscription is live again (a pending voice rejoin waits for that — the
  join-time producer replay rides this subscription).
- **DM events in the dispatcher**: `guildId === null` routes `message.created` / `channel.*` to the
  `dm.list` cache (`patchDmList`; a message for an unlisted DM channel invalidates instead — that's how a
  brand-new 1:1 reaches the recipient's sidebar). `readState.updated` patches both list caches (keyed
  rows, wrong list is a no-op). `dm.participant.removed` for the OWN user drops the sidebar row and
  raises the `dmEvictedKey` tombstone; the mounted conversation view watches it, navigates home, and
  removes the history/typing/`dm.get` caches only AFTER leaving — invalidating them while still
  mounted would refetch as a non-participant and toast FORBIDDEN.
- **Guild membership events in the dispatcher**: `guild.member.removed` for the OWN user drops the
  rail row and raises the `guildEvictedKey` tombstone; the guild layout (`guilds/$guildId/route.tsx`)
  watches it, navigates home, and removes `guild.get` / `channel.list` caches only AFTER leaving
  (same FORBIDDEN-refetch discipline as DM eviction). For other users it invalidates that guild's
  `guild.get` (roster refresh — members panel / settings modal update live). `guild.member.added`
  for the own user clears a stale tombstone (rejoin after kick) and refreshes the rail in other tabs.
  `guild.updated` (ownership transfer) re-reads `guild.get` — the settings entry, the crown, and the
  modal's owner-flip guard all react live. `guild.deleted` evicts every recipient the same
  tombstone way, no per-user check.
- **Key discipline**: the channel view and the dispatcher MUST build history keys through
  `historyInfiniteOptions` / `historyInfiniteKey` — a hand-built key silently misses the cache.
- **Typing / presence** live in plain client-only query keys (`["realtime", ...]`) read via
  `useTypingEntries` / `usePresence`; no fetcher behind them.
- **Voice (`lib/voice/`, phase 5)** — two tiers per the spec (§Client architecture): guild-wide
  occupancy (seats + flags + speaking sets) in the client-only `["realtime","voice-occupancy"]` key,
  fed by the dispatcher through the pure `reduceVoiceOccupancy` reducer (`occupancy.ts`, read via
  `useVoiceOccupancy`); the live media session in a zustand store (`store.ts`) fronted by the
  module-singleton **`voiceSession`** (`session.ts`) — the ONLY writer of the
  `idle → joining → connected → reconnecting` machine. mediasoup-client objects never enter any
  cache. The dispatcher forwards `producerAdded/producerClosed` (own-user events filtered — a peer
  never consumes itself), `sessionReplaced`, and `mediaReset` to the session. One recovery path:
  signaling failure / socket death / `mediaReset` / transport failure → `reconnecting` → rejoin
  (`voice.join` is the universal entry), EXCEPT `TOO_MANY_REQUESTS` and definitive rejections (room
  full, channel gone), which surface and go idle. Teardown only on leave / channel switch / logout —
  never navigation. `components/voice-audio-bridge.tsx` (mounted once in the `(app)` shell) renders
  all remote `<audio>` with per-peer volume (localStorage-persisted); video consumers stay
  server-paused until a component `bindVideo`s their consumerId AND the tab is visible (~3 s hidden
  debounce, instant resume).
- **Chat components** (`components/chat/`): `message-list` (infinite scroll upward; the shadcn
  `message-scroller` primitive owns the scroll contract — open at the newest message, auto-follow at the
  live edge, position preserved when older pages prepend, jump-to-bottom button; still no virtualization —
  instead the history cache is trimmed to the newest ~150 messages whenever the reader is back at the live
  edge, so long sessions stay bounded), `message-item` (hover reply/edit/delete; cache updates come from
  the author's own realtime events, never from mutation handlers), `message-markdown` (react-markdown +
  GFM, mention pills), `composer` (raw-markdown textarea, Enter sends, `@` autocomplete, 4 s typing
  throttle; sending jumps the reader to the live edge), `typing-line`. The channel route wraps list +
  composer in one `MessageScrollerProvider` keyed by channel.
- **markRead** fires whenever the viewed channel's newest message changes while the window is focused —
  EXCEPT when that newest message is the viewer's own: `chat.sendMessage` advances the author's watermark
  server-side and confirms via `readState.updated`, so a client markRead per own send is pure noise. The
  caller tab patches its own sidebar cache in `onSuccess`; other tabs get the `readState.updated` event.

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
