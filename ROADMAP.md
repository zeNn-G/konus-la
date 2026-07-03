# Roadmap

A Discord-style app for a small self-hosted friends instance — multi-guild text + voice/video/screenshare, group DMs, mediasoup SFU. This document captures the decisions and the phased build order.

## Context

- **Audience:** friends group, ~100 users total, ≤20 concurrent per voice room.
- **Deployment:** single VPS, Docker Compose, one Bun process. No clustering, no sharding.
- **Stack baseline:** Bun + ORPC + React SPA + Drizzle/libSQL + Better Auth (Better-T-Stack monorepo).

---

## Decisions

### Scope & shape

- Multi-guild, but minimal: no nested categories, no custom roles, no fancy guild settings. DMs live outside any guild.
- Per-guild roles: **Owner / Admin / Member** (single enum on `GuildMembership`).
- **Signup is invite-code-gated.** Instance owner mints codes; Better Auth signup wraps a code validator.
- **Guild creation is open with a per-user cap** (default 5; env-var).
- **Joining a guild is invite-code-only** (codes carry optional `expiresAt` + `maxUses`). No direct-add-by-username.
- **No email verification** in v1 (signup gate is the trust boundary). Password reset = admin CLI script for v1; email-link flow later when SMTP exists.
- **No OAuth providers** in v1 (would bypass the invite-code gate).

### Channel features

- **Text channels:** send / edit / delete / reply, basic markdown; channel rename (`channel.update`, added in Phase 3 — hard deletes made name typos too expensive). ❌ no file attachments, no threads, no reactions in v1 (reactions parked as post-v1 nice-to-have).
- **Voice channels (full set day one):** audio + webcam video + screenshare. No simulcast.
- **DMs:** 1:1 **and** group DMs (size cap via env). Modeled as `Channel { kind: 'dm', guildId: null }` + a `ChannelParticipant` table — same message + WS paths as guild channels. Voice in DMs deferred (schema supports it).

### Realtime transport

- **Hybrid transport** (amended in Phase 3, see [ADR 0005](docs/adr/0005-per-user-topic-realtime-hybrid-transport.md)): queries/mutations stay on the fetch `RPCLink`; ONE WebSocket (`@orpc/server/bun-ws`) carries only the `realtime.events` event-iterator subscription (and presence, via socket lifecycle). Phase 5 may route `voice.*` signaling over the same socket.
- Server → client: ORPC **event iterators** — a single per-connection iterator on the user's own `user:{userId}` topic carrying a discriminated `RealtimeEvent` union; recipient sets are computed at publish time (`publishTo(userIds, event)`).
- WS auth: Better Auth session cookie validated on the upgrade request (Origin-checked, 401 before upgrade); upgrade headers ride the per-connection context so `requireAuth` re-checks per call. ✅ Phase 3.
- Server-side pub/sub: `@orpc/experimental-publisher/memory` `MemoryPublisher<EventMap>` with `resumeRetentionSeconds: 120` (`lastEventId` resume; clients invalidate all queries on reconnect as the silent-gap fallback). Redis adapter swap available if/when needed.

### Server runtime

- **Drop Hono.** Use `Bun.serve({ fetch, websocket })` directly. ORPC HTTP `RPCHandler` (OpenAPI-friendly routes) + Better Auth handler + ORPC WS `RPCHandler` (live). Tiny CORS middleware over `fetch`; logging via pino interceptor.
- **mediasoup runs in-process on Bun** via the Sharkord Windows IPC workaround (monkey-patches `child_process.spawn` only for the `mediasoup-worker` binary, swaps to `Bun.spawn` for real stdio fds; no-op on Linux). Vendored into `apps/server/src/sfu/`.

### Mediasoup model

- **Router per voice channel**, created lazily on first join, closed when last peer leaves.
- **1 mediasoup Worker at boot** (more only if profiling demands).
- **Per peer:** separate send + recv `WebRtcTransport`; producers for mic (always), optional webcam, optional screenshare; consumer per other peer's producer.
- **NAT traversal v1:** UDP + TCP fallback (`enableUdp: true, enableTcp: true, preferUdp: true`), `announcedIp = env.PUBLIC_IP`, ports pinned to `40000-40100`. **No coturn / TURN** in v1 — add only if real users report connection failures.
- **Voice semantics:**
  - Self-mute / self-deafen are client-side pauses with server-broadcast badges and `VoiceState` flags.
  - Server-mute (admin) pauses the victim's producer authoritatively; victim cannot self-resume.
  - PTT and voice activity are client-side toggles; audio producer always exists, paused/resumed locally.
  - Codecs: Opus (audio), VP8 (webcam + screenshare). No simulcast in v1.
  - Producer limits per peer: 1 audio + ≤1 webcam + ≤1 screenshare.
  - Channel switch = full teardown + fresh transports.
  - Reconnect grace: ≤30 s WS disconnect holds peer state server-side; >30 s closes the peer and broadcasts `voice.peerLeft`.
- **Voice activity detection:** server-side mediasoup `AudioLevelObserver`; server emits `voice.activeSpeakers` at ~2 Hz; clients render speaking rings off the stream.

### Voice / video UX

- `getUserMedia` audio constraints all on by default: echo cancellation, noise suppression, auto gain control.
- Input device picker (localStorage-persisted selection; `devicechange` reapplies).
- Output device picker via `setSinkId` where supported; hidden on Safari (feature-detect).
- Per-peer volume slider on each tile; persisted in localStorage keyed by `userId`.
- Screenshare audio opt-in (`getDisplayMedia({ audio: true })`), graceful video-only fallback when browser refuses.
- Tile-grid UI; mute / deaf / screenshare badges; tile dimming driven by speaker events. Stage layout deferred.

### Presence, unread, typing

- **Presence (binary online/offline):** computed in memory from `presenceMap: Map<userId, number>` of open-WS counts. 0→1 and 1→0 (after 5 s debounce) broadcast `presence.update` to the union of users sharing a guild or DM with the subject.
- **Unread (server-side):** `ChannelReadState { userId, channelId, lastReadMessageId, mentionsCount }`. `channel.markRead` updates the marker and zeroes mentions. Server parses `@user` on insert and increments `mentionsCount` for affected participants.
- **Typing indicators (ephemeral):** `typing.start(channelId)` → server emits `typing { userId, channelId, expiresAt: now+5s }` to other participants. No DB.

### Moderation, reports, audit log

- **Actions in v1:** message delete (author or admin) + edit (author); voice server-mute + voice-disconnect; kick / ban / unban (admin); promote-demote admin (owner); transfer ownership (owner); channel create / delete (admin); instance-ban (instance owner, flags `User.instanceBanned`, terminates sessions). **No timeout** in v1.
- **Reports:** `Report { reporterId, messageId, reason, resolvedAt, resolvedById }`. Any user can report; owner/admin sees a simple inbox list with "resolve" action.
- **Audit log (per guild):** `AuditLogEntry { guildId, actorId, action, targetUserId?, targetChannelId?, targetMessageId?, metadata, createdAt }`. Every mod procedure calls `auditLog.record(...)`. Read-only paginated list view in guild settings. No retention policy in v1.

### Message history

- **IDs:** ULID text PK (sortable, monotonic).
- **Pagination:** cursor-based `chat.history({ channelId, before?: messageId, limit })` (default 50, max 100). Index `(channelId, id DESC)`.
- **Edit history:** none — `editedAt` timestamp + "(edited)" badge; old content not retained.
- **Deletes:** hard delete + `message.deleted` event; audit log captures the actor.
- **Retention:** forever in v1.
- **Search:** none in v1. SQLite FTS5 is a natural additive future step.

### Auth + user profile

- Better Auth, email/password only, signup wrapped by invite-code validator (Better Auth hooks).
- Profile fields on the `user` table:
  - `username` — unique, lowercase, `^[a-z0-9_]{3,20}$`, immutable post-signup, used for `@mentions`.
    The only column added in Phase 1. Reserved: `everyone`, `here`, `admin`, `system`, `owner`.
  - **displayName = Better Auth's `name`** — mutable, what shows in chat (no separate column).
  - **avatarUrl = Better Auth's `image`** — nullable; Dicebear fallback in client when null. No setter
    in v1 (object storage is post-v1), so it stays null and everyone gets a generated avatar.
  - **instanceBanned = admin plugin's `banned`** (+ `banReason` / `banExpires`); owner = admin plugin
    `role: 'admin'`. No hand-rolled boolean.
- WS auth via session cookie on upgrade. Cookie tightened to `SameSite=Lax` (same-origin deploy makes the cross-site default unnecessary).

### Clients & notifications

- **v1 client:** web SPA only. PWA install (manifest + service worker shell) is the immediate next step after v1 — no code rewrite. Tauri / Electron later if desired.
- **Notifications:** in-app (toast + sound + tab-title flicker) + browser Notifications API for backgrounded tabs. **No Web Push / service-worker push in v1.**
- Per-channel mute preference (All / Mentions only / Muted) stored in localStorage. Defaults: Mentions-only for guild channels, All for DMs.

### Frontend state

- TanStack Query for server state (already wired).
- **Hybrid reconciliation:**
  - Initial channel mount fetches via `chat.history` (normal `useQuery`).
  - Top-level `useRealtime()` hook holds the ORPC event-iterator subscription; dispatcher decides `setQueryData` (high-frequency: messages, typing, presence, speakers) vs `invalidateQueries` (low-frequency structural: channel / role / membership changes).

### Rate limiting, logging, migrations

- **Rate limit:** `@orpc/experimental-ratelimit/memory` + `createRatelimitMiddleware`. Defaults: ~30 messages / 10 s per user on `chat.sendMessage`; ~5 invites / hour on `guildInvite.create`; ~60 `markRead` / minute. Redis adapter parked for later.
- **Logging:** pino (`pino` + `pino-pretty` in dev), wired through ORPC `onError` and a thin request log.
- **Drizzle:** `drizzle-kit push` during early schema iteration; switch to `drizzle-kit generate` + checked-in migration files before any real users land on the instance.

### Deployment

- **Single VPS, Docker Compose.**
- Containers: `bun-server` (HTTP + WS + mediasoup + bundled SPA) and `caddy` (TLS + reverse proxy to `bun-server:3000`).
- Mediasoup ports UDP+TCP `40000-40100` mapped host → container directly (bypass Caddy). `PUBLIC_IP` env = host's public IP, used as mediasoup `announcedIp`.
- DB: local libSQL file in a named Docker volume. Backups = copy the file.
- SPA served same-origin from the Bun container.
- `restart: unless-stopped`.
- Single `.env` at repo root, validated by `packages/env`.

---

## Domain language (additions to existing `CONTEXT.md` vocabulary)

- **Guild** — a self-contained server people belong to; owns channels and memberships.
- **GuildMembership** — a user's role inside one guild (`owner` | `admin` | `member`).
- **Channel** — text, voice, or DM. Either belongs to a Guild or is a DM (no guild).
- **ChannelParticipant** — only used for DM channels (1:1 or group).
- **Message** — a text post in a channel; ULID-keyed; cursor-paginated.
- **ChannelReadState** — per-user per-channel read watermark (`lastReadMessageId`, forward-only) + mention counter; missing row = everything unread.
- **RealtimeEvent** — the discriminated union of server→client events, delivered on the recipient's own `user:{userId}` topic.
- **VoiceState** — DB row reflecting "user X is currently in channel Y; flags (selfMute / selfDeaf / serverMute)".
- **Room** — in-memory mediasoup state for one occupied voice channel (`router` + `peers` map).
- **Peer** — in-memory state for one user inside one Room (transports + producers + consumers).
- **AuditLogEntry / Report** — moderation receipts.
- **SignupCode / GuildInvite** — gating tokens for the two join flows.

---

## Roadmap

Each phase ends with something demoable. Earlier phases unblock later ones.

### Phase 0 — Foundations

- Drop Hono; switch `apps/server/src/index.ts` to `Bun.serve`.
- Wire pino logging.
- Add `packages/env` vars for `PUBLIC_IP`, `MAX_GUILDS_PER_USER`, mediasoup port range.
- Add shared `EventMap` types + `MemoryPublisher` setup (in `packages/api` or a new `packages/realtime`).

### Phase 1 — Users, signup gate, profile ✅

- Extend `user`: add `username` (the only new domain column). **displayName reuses Better Auth's
  `name`; avatarUrl reuses `image`; instanceBanned + owner role come from the Better Auth admin plugin**
  (`banned` / `role`) — adopted this phase. See [ADR 0003](docs/adr/0003-phase1-auth-hooks.md).
- `SignupCode` table + admin ORPC surface `signupCode.create / list / revoke` (Instance Owner only).
- Wrap Better Auth signup via hooks: validate + consume a code (passed as the `x-signup-code` header),
  set the first user as Instance Owner, capture an immutable `username` (Better Auth `additionalField`).
- `profile.update` ORPC procedure (displayName only; username immutable, enforced by a `user.update`
  hook that strips it).
- Web: signup / login / profile / admin-codes routes, TanStack Router auth guards, Dicebear avatar
  fallback (seeded by username) in `@konus-la/ui`.

### Phase 2 — Guilds, memberships, invites

- Tables: `Guild`, `GuildMembership`, `GuildInvite`, `GuildBan`.
- ORPC: `guild.create / list / get`, `guildInvite.create / consume`, `guildMember.kick / ban / unban / setRole`, `guild.transferOwnership / delete`.
- Per-user cap enforced on `guild.create`.
- Web: guild list rail, create-guild modal, join-by-code page, settings page (members list, role chips).

### Phase 3 — Text channels, messages, presence, typing ✅

- Tables: `Channel`, `Message` (ULID PK), `ChannelReadState`. `guild.create` seeds `#general`.
- ORPC: `channel.create / update / delete / list`, `chat.sendMessage / editMessage / deleteMessage / history`, `channel.markRead` (forward-only watermark), `typing.start`. Rate limits land here (`@orpc/experimental-ratelimit`, per-user; invite.create retrofitted).
- Event iterators: single `realtime.events` per connection on `user:{userId}` topics — `message.created / updated / deleted`, `typing`, `presence.update / snapshot`, `readState.updated`, `channel.created / updated / deleted`. See [ADR 0005](docs/adr/0005-per-user-topic-realtime-hybrid-transport.md).
- WS auth (session cookie at upgrade) — pulled forward from Phase 5; presence map in memory with 5 s debounced offline broadcast.
- Web: channel sidebar (unread bold + mention badge), message list (cursor-paginated, infinite scroll, no virtualization), textarea composer with markdown + `@mention` autocomplete (no TipTap), typing line, presence dots, `useRealtime()` dispatcher.

### Phase 3.5 — Guild roles (parked)

- Admin role assignment (`guild.member.setRole`), `requireGuildAdmin` gate widening channel management + moderation beyond the owner; `guild.memberRemoved` event so kicked members' clients react. Deferred from Phase 3 to keep it channel-focused.

### Phase 4 — DMs (1:1 + group)

- Tables: `ChannelParticipant`.
- ORPC: `dm.openWithUser / createGroup / addParticipant / removeParticipant / leave`.
- Reuse all chat code (DM is just a channel with `kind='dm'`).
- Web: DM list, group-DM creation modal, DM channel view.

### Phase 5 — Voice / video MVP

- `apps/server/src/sfu/` module: worker bootstrap with Bun workaround, `rooms: Map`, helpers.
- ORPC voice procedures: `voice.getRouterRtpCapabilities`, `voice.createTransport`, `voice.connectTransport`, `voice.produce`, `voice.consume`, `voice.closeProducer`, `voice.leave`.
- `VoiceState` table + WS events: `voice.peerJoined / peerLeft / producerAdded / producerClosed / peerMutedSelf / peerDeafenedSelf / serverMuteSet`.
- `AudioLevelObserver` per router → `voice.activeSpeakers` event at ~2 Hz.
- Web: mediasoup-client integration, voice connection bar, tile grid, mute / deafen / leave controls, screen-share + webcam buttons, device pickers (in/out), per-peer volume sliders.

### Phase 6 — Moderation & audit

- Tables: `AuditLogEntry`, `Report`.
- `auditLog.record(...)` helper called from every mod procedure (back-fill earlier phases).
- ORPC: `mod.kick / ban / unban / muteVoice / disconnectVoice / instanceBan`, `report.create / list / resolve`.
- Web: audit log list view per guild, report inbox.

### Phase 7 — Notifications & in-app polish

- Browser Notifications API integration; sound + tab-title flicker.
- Per-channel mute pref in localStorage; default Mentions-only.
- Master output volume slider; voice settings page.

### Phase 8 — Deployment

- Dockerfile (multi-stage: build web → copy into bun runtime image).
- `docker-compose.yml` with `bun-server` + `caddy`.
- Caddyfile with TLS + WS upgrade pass-through.
- README "Self-Host" section listing required env vars and firewall opens (TCP/UDP `40000-40100`, `:443`, `:80`).
- Smoke-test runbook.

### Post-v1 (parked / additive)

- File / image attachments (object storage + upload pipeline).
- Reactions on messages.
- Threads.
- SQLite FTS5 search + search UI.
- Email-link password reset + verification (requires SMTP).
- Web Push / service-worker push (VAPID + `PushSubscription` table).
- coturn TURN server (if real connection failures appear).
- OAuth providers.
- PWA install assets and offline shell.
- Tauri / Electron desktop wrapper.
- Custom roles / per-channel permission overrides.
- Voice in DMs ("call your friend") — schema already supports it.
- Channel categories / folders.
- Audit log retention policy + filters.
- Move ORPC publisher and ratelimiter to Redis adapters if instance grows.

---

## Verification

After each phase:

- **Phase 1:** can sign up only with a valid code; can log in; can edit profile.
- **Phase 2:** owner can create a guild (rejected past the cap), generate an invite code, another user joins via code, admin can promote / kick.
- **Phase 3:** two browser tabs as different users see each other's messages live, presence dots, typing indicator, unread badge, mention count.
- **Phase 4:** open DM with anyone on the instance; create a 3-person group DM; same chat behaviors as guild channels.
- **Phase 5:** three browser tabs join the same voice channel; each can publish mic, toggle cam, share screen; mute / deafen / leave all behave. Test across LAN and across NAT (use TCP fallback by blocking UDP). Verify audio quality with all three audio constraints. Verify channel switch tears down cleanly.
- **Phase 6:** admin actions are visible in audit log; instance-ban kicks all sessions; reports flow shows up in inbox.
- **Phase 7:** background-tab notifications fire on DM / mention; sounds play; per-channel mute hides them.
- **Phase 8:** fresh VPS → `docker compose up` → app reachable on HTTPS, voice works for users on different networks.

Cross-cutting checks throughout:

- mediasoup workers respawn on crash; clients reconnect on transient WS drop within 30 s without losing voice room.
- pino logs are JSON in prod, pretty in dev.
- Rate limits trigger as designed (deliberately spam to confirm).
- `drizzle-kit generate` produces clean migrations once schema is stable.
