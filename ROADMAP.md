# Roadmap

A Discord-style app for a small self-hosted friends instance — multi-guild text + voice/video/screenshare, group DMs, mediasoup SFU. This document captures the decisions and the phased build order.

## Context

- **Audience:** friends group, ~100 users total, ≤20 concurrent per voice room.
- **Deployment:** single VPS, Docker Compose, one Bun process. No clustering, no sharding.
- **Stack baseline:** Bun + ORPC + React SPA + Drizzle/libSQL + Better Auth (Better-T-Stack monorepo).

---

## Decisions

### Scope & shape

- Multi-guild, but minimal: no nested categories. DMs live outside any guild.
- Per-guild roles: **custom roles + permission bitfield + position hierarchy** (Discord-style; 12 bits, multi-role, `@everyone` at position 0). Amended in Phase 6 — see [ADR 0008](docs/adr/0008-rbac-activation-permission-bitfield.md), which supersedes the earlier "Owner / Admin / Member single enum" plan. No per-channel overwrites in v1.
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
  - Server-mute (`MUTE_MEMBERS`) pauses the victim's audio producers authoritatively; victim cannot self-resume. Persists as a `serverMuted` flag on `GuildMembership`, applied to fresh seats on `voice.join`.
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

- **Actions in v1** (each gated by its permission bit — [ADR 0008](docs/adr/0008-rbac-activation-permission-bitfield.md)): message delete (author, or `MANAGE_MESSAGES` with confirm + optional reason) + edit (author); voice server-mute (`MUTE_MEMBERS`, persistent flag) + voice-disconnect (`MOVE_MEMBERS`); kick / ban / unban (`KICK_MEMBERS` / `BAN_MEMBERS`); role management (`MANAGE_ROLES`); transfer ownership (owner); channel create / rename / delete (`MANAGE_CHANNELS`); instance-ban (instance owner, Better Auth admin plugin `banned` + full session revocation, **required reason**). Member-targeted actions also require outranking the target. **No timeout** in v1.
- **Reports (guild messages only, no DM reports):** `Report { guildId, reporterId, messageId?, messageAuthorId, messageContent, reason, resolvedAt?, resolvedById? }` — content snapshotted at report time so reports survive hard deletes. Any member can report; the per-guild inbox is gated `MANAGE_REPORTS`; resolve = mark only.
- **Audit log (per guild):** `AuditLogEntry { guildId, actorId, action, targetUserId?, targetChannelId?, targetMessageId?, metadata, createdAt }`. Every privileged mutation records an entry (self-service actions, joins/leaves, and instance-ban don't). Read gated `VIEW_AUDIT_LOG` — paginated list view in guild settings, no realtime tail. No retention policy in v1.

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
- **Notifications** (amended in Phase 7 — see the [phase-7 spec](docs/specs/phase-7-notifications.md)): browser Notifications API + sound when the tab is away, sound only when focused on another channel, silent when viewing; static `(n)` tab-title counter (no flicker). Guild messages ping strictly on @mentions; any DM message pings. **No Web Push / service-worker push in v1.**
- Per-channel mute preference (guild: All / Mentions-only / Muted; DM: All / Muted) stored in localStorage. Defaults: Mentions-only for guild channels, All for DMs.

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

Amended in Phase 8 — see [ADR 0009](docs/adr/0009-single-image-single-port-deployment.md)
and the [Phase 8 spec](docs/specs/phase-8-deployment.md), which supersede the earlier
"compose stack is the deployment" plan and the `40000-40100` port range.

- **One public Docker image is the product** (`ghcr.io/zenn-g/konus-la`, amd64+arm64):
  SPA + API + WS + mediasoup on plain HTTP `:3000`. TLS is the host's concern — raw VPSs
  use the shipped compose file (image + Caddy); Dokploy/Coolify run the bare image behind
  their own proxy.
- **Single-port media:** mediasoup `WebRtcServer` multiplexes all transports over one
  UDP+TCP port (`MEDIA_PORT`, default `40000`), published host → container directly
  (bypasses the proxy). `PUBLIC_IP` = announced address, auto-detected at boot
  (env override).
- **One required env var:** `APP_URL`. Secret auto-generated into the volume, auth
  URL/CORS derived, everything else defaulted.
- DB: local libSQL file in the `/data` volume; drizzle migrations apply on boot behind a
  pre-migration `VACUUM INTO` snapshot (count-pruned). Backups beyond that = copy the file.
- SPA served same-origin from the Bun process; updates are stop-and-swap.
- Releases: changesets Version-Packages PR → `v*` tag → chained GHCR image build; first
  release `v1.0.0`.

---

## Domain language (additions to existing `CONTEXT.md` vocabulary)

- **Guild** — a self-contained server people belong to; owns channels and memberships.
- **GuildMembership** — a user's membership in one guild (+ `serverMuted` flag). Roles live in `GuildRole` (per-guild role: `permissions` bitfield, `position`, `color`; one seeded `@everyone` per guild) and `MemberRole` (assignments; membership alone = `@everyone`).
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

### Phase 3.5 — Guild roles (folded into Phase 6)

- The parked admin-role slice was superseded before it was built: delegation ships as full custom-role RBAC in Phase 6 (see [ADR 0008](docs/adr/0008-rbac-activation-permission-bitfield.md)) — no `setRole`, no `requireGuildAdmin`. (`guild.member.removed` shipped earlier, with Phase 4/5 groundwork.)

### Phase 4 — DMs (1:1 + group) ✅

- Tables: `ChannelParticipant`; `channel` gains `isGroup` / `dmPairKey` / `ownerId`. See [ADR 0006](docs/adr/0006-participant-keyed-dm-channels.md).
- 1:1 and group DMs are distinct flavors: 1:1s are pair-unique (`dmPairKey`), draft-created on first message (Teams-style), never upgrade to groups; groups have a creator-owner (add = anyone, remove = owner, owner-leave auto-transfers, last-leaver deletes), optional free-text name, `MAX_DM_GROUP_SIZE` cap (default 10, ≥3 at creation).
- ORPC: `dm.openWithUser / createGroup / addParticipant / removeParticipant / leave / rename / list / get` + `user.search / get` (instance-wide directory for the pickers).
- Reused all chat code (DM is just a channel with `kind='dm'`): `requireChannelMember` branches to a participant check, fan-out to participant sets, mentions resolve against participants, presence unions DM co-participants. DM message deletion is author-only.
- Web: Home (`/`) is the DM zone (sidebar + empty pane), `/dms/$channelId` conversation view, `/dms/new/$userId` draft view, new-DM/new-group pickers, group members popover + rename/leave menu, "Message" action on guild member rows.

### Phase 5 — Voice / video MVP ✅

- `apps/server/src/sfu/` worker manager (Bun spawn workaround, crash respawn); rooms are **in-memory only** in `packages/api/src/voice/` — Room / Seat / Peer, router + `AudioLevelObserver` created lazily per occupied channel, **no `VoiceState` table** (a restart empties every room by design). See [ADR 0007](docs/adr/0007-voice-in-memory-rooms-ws-seats.md) and the [phase-5 spec](docs/specs/phase-5-voice.md).
- ORPC voice procedures over the realtime socket: `voice.join` (the universal entry — fresh join, channel switch, grace rebind, multi-tab steal, post-crash recovery), `leave`, `setSelfMute / setSelfDeaf`, `getRouterRtpCapabilities`, `createTransport / connectTransport`, `produce / closeProducer`, `consume / setConsumersPaused`.
- WS events: `voice.snapshot` (on subscribe) + `peerJoined / peerLeft / peerMutedSelf / peerDeafenedSelf / activeSpeakers` (guild-wide; speaking sets edge-triggered off the observer), `producerAdded / producerClosed` (room-only), `sessionReplaced / mediaReset` (self-only). Server-mute (`serverMuteSet`) moved to Phase 6 with the rest of moderation.
- Lifecycle hardening: 30 s grace on socket loss; deleting a channel or guild evicts its rooms (#39); kick / ban / self-leave releases the member's seat (#42); worker death/respawn recovers via `mediaReset` rebinds.
- Web: `voiceSession` singleton (mediasoup-client, one recovery path), voice stage + connection capsule, tile grid with speaking rings, mute / deafen / leave, webcam + screenshare (opt-in share audio), device pickers (in/out), per-peer volume, visibility-driven video consumer pausing.

### Phase 6 — Guild roles & moderation (absorbs Phase 3.5)

See the [phase-6 spec](docs/specs/phase-6-roles-and-moderation.md) and [ADR 0008](docs/adr/0008-rbac-activation-permission-bitfield.md).

- Schema (additive): `guildRole.permissions` bitfield + `guildRole.color`, `guildMembership.serverMuted`; new tables `Report`, `AuditLogEntry`.
- Permission plumbing: frozen 12-bit catalog (`@konus-la/api/permissions`), per-request evaluation, `requireGuildPermission` / `requireChannelPermission` middleware factories, hierarchy helpers; existing owner-gated procedures regated to their bits; `guild.get` exposes `viewer.permissions` as a resolved mask.
- ORPC: `role.create / update / delete / reorder / assign / unassign`, `mod.deleteMessage / serverMute / disconnectVoice`, `report.create / list / unresolvedCount / resolve`, `auditLog.list`, `admin.banUser / unbanUser / listBannedUsers` (instance-ban via Better Auth `banUser` + voice/socket teardown), `guild.update` (rename, `MANAGE_GUILD`).
- `recordAuditEntry(...)` called from every privileged mutation (instrumenting existing procedures; history starts at ship).
- Events: `role.changed`, `member.rolesChanged`, `voice.serverMuteSet`, `report.changed` (first permission-derived recipient set); voice seats grow `serverMuted`.
- Web: master–detail roles editor, permission-gated settings sections, assignment chips on member rows, member list grouped by highest role with color tints, mod actions in context menus, report inbox + audit log views, banned sign-in inline error + zombie-tab session re-check.

### Phase 7 — Notifications & in-app polish

See the [phase-7 spec](docs/specs/phase-7-notifications.md). Client-only — no schema, no new events, no server-side preference storage.

- Notification dispatcher: browser Notifications API + ping sound on eligible messages (any DM message; guild messages strictly on @mention), judged at event arrival — away (`!document.hasFocus()`) = OS toast + sound, focused elsewhere = sound only, viewing = silent. Static `(n) konus-la` tab title derived from the mention/unread query caches. App-level desktop-notifications pref defaults off; permission requested only on a user gesture.
- Per-channel notification prefs (guild: All / Mentions-only / Muted; DM: All / Muted) as a localStorage overrides map (`konusLa.notification-prefs`), set via sidebar right-click context menu; muted rows dim; cross-tab `storage` sync.
- **User-settings dialog** (Discord-style, guild-settings shell): Profile / Voice / Notifications sections + admin group (invite codes, instance bans) + sign-out, triggered solely by the UserCard chip — replaces the `/profile` route, the `/admin/*` routes, and the ControlDeck device popover.
- **Master output volume** (0–1, localStorage) scaling all app audio — voice via `element.volume` multiplier, effects via a master GainNode; **mic input volume** slider + AGC / noise-suppression / echo-cancellation toggles via a persistent Web Audio mic chain feeding the producer.
- **Sound-effects system:** CC0 (Kenney) MP3 assets, Vite-hashed, preloaded into Web Audio buffers behind one shared AudioContext; notification ping + voice UX sounds (self join/leave, mute/deafen, peer join/leave), individually toggleable.

### Phase 8 — Deployment

Spec: [phase-8-deployment.md](docs/specs/phase-8-deployment.md) ·
[ADR 0009](docs/adr/0009-single-image-single-port-deployment.md) · wayfinder map
[#98](https://github.com/zeNn-G/konus-la/issues/98).

- Precursor PR: mediasoup `WebRtcServer` single-port media (`MEDIA_PORT`, `PUBLIC_IP`
  rename, port-range env vars deleted).
- In-process TS boot sequence (`boot.ts`): secret gen → IP detect → pre-migration
  `VACUUM INTO` backup (retention 5) → drizzle `migrate()` → serve; failed migration =
  exit 1, roll back a tag.
- Same-origin SPA serving (static + `index.html` fallback + Vite cache contract;
  `VITE_SERVER_URL` demoted to dev override) and a `/health` endpoint + `HEALTHCHECK`.
- Multi-stage Dockerfile (`oven/bun` debian slim, non-root, `/data` volume, prebuilt
  mediasoup worker guard).
- `deploy/` compose recipe (app + Caddy + commented Watchtower) — copy 3 files, set
  `DOMAIN`, `docker compose up -d`; firewall opens `80`, `443`, `40000/tcp+udp`.
- Release pipeline: changesets (root-as-workspace-member) + release/image/CI workflows,
  `workflow_call`-chained GHCR build → `v1.0.0`.
- Docs: README "Self-Host", `docs/self-hosting/` (Dokploy, Coolify, troubleshooting),
  smoke-test runbook (full VPS pass for v1.0.0, local-Docker pass per release).

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
- Per-channel permission overwrites (custom roles shipped in Phase 6).
- Role `hoist` flag (member list groups by highest role instead), role icons, drag-and-drop role reorder.
- Server-deafen; timeout / temp-mute; DM message reports; instance-ban expiry UI.
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
- **Phase 6:** roles are creatable / colorable / reorderable / assignable and the member list regroups + retints live in a second browser; a member with a single permission bit sees exactly the settings sections it grants; equal-rank moderation attempts are rejected; server-mute locks the target's mic silently and survives rejoin + server restart; reports flow into the gated inbox and survive message deletion; every privileged mutation is visible in the audit log; instance-ban kicks all sessions within seconds and re-login shows the banned message.
- **Phase 7:** an away tab gets OS toast + sound on DM / mention, a focused tab on another channel gets sound only, viewing gets silence; per-channel mute silences every open tab and dims the row while the unread badge survives; the tab title counts mentions + unread DM convos; the user-settings dialog owns profile, devices, master output + mic input volume, processing and sound toggles, and the admin surfaces — `/profile` and `/admin/*` routes are gone.
- **Phase 8:** fresh VPS → `docker compose up` → app reachable on HTTPS, voice works for users on different networks.

Cross-cutting checks throughout:

- mediasoup workers respawn on crash; clients reconnect on transient WS drop within 30 s without losing voice room.
- pino logs are JSON in prod, pretty in dev.
- Rate limits trigger as designed (deliberately spam to confirm).
- `drizzle-kit generate` produces clean migrations once schema is stable.
