# Phase 6 — guild roles & moderation

Implementation spec, distilled from wayfinder map
[#46](https://github.com/zeNn-G/konus-la/issues/46). ROADMAP divergences are recorded in
[ADR 0008](../adr/0008-rbac-activation-permission-bitfield.md) (amending ADR 0004: RBAC
activated); everything the ADR doesn't amend keeps the ROADMAP's "Moderation, reports,
audit log" defaults. Ticket numbers (#47–#52) mark where a decision's full rationale lives.

## Scope

**In:** permission bitfield on `guildRole` + custom roles (create / edit / color / reorder /
delete) with position hierarchy; multi-role assignment; permission-gated procedures replacing
the owner-only gates; server-mute (persistent) + voice-disconnect; mod message-delete;
per-guild message reports; per-guild audit log; instance-ban via the Better Auth admin plugin
(+ banned sign-in UX and the zombie-tab fix); four new realtime events; role-grouped member
list with role colors; permission-gated guild settings.

**Out (per map):** per-channel permission overwrites · `hoist` flag (grouping by highest role
instead) · DM message reports + instance-level report inbox · server-deafen ·
timeout / temp-mute · audit-log retention & filters · role icons · instance-ban expiry UI
(`banExpires` exists in schema, unused) · drag-and-drop role reordering (▲▼ buttons in v1).

## Permission catalog — #47

Constants live in **`packages/api/src/permissions.ts`** — a pure, zero-import module
(`PERMISSIONS`, `hasPermission(bits, bit)`), importable by the web app as
`@konus-la/api/permissions` via the existing `./*` subpath export. `packages/db` traffics in
raw integers only. **Bit order is frozen forever**; new permissions append only.

| Bit | Permission | Gates |
| --- | --- | --- |
| 0 | `ADMINISTRATOR` | Bypasses every permission check (never hierarchy, never owner-only) |
| 1 | `MANAGE_GUILD` | `guild.update` (rename — new in this phase) |
| 2 | `MANAGE_ROLES` | `role.*` (create / update / delete / reorder / assign / unassign) |
| 3 | `MANAGE_CHANNELS` | `channel.create / update / delete` |
| 4 | `MANAGE_INVITES` | `guild.invite.create / list / revoke` |
| 5 | `KICK_MEMBERS` | `guild.member.kick` |
| 6 | `BAN_MEMBERS` | `guild.member.ban / unban / banList` |
| 7 | `MANAGE_MESSAGES` | `mod.deleteMessage` (others' messages; own-delete stays author-only) |
| 8 | `MUTE_MEMBERS` | `mod.serverMute` |
| 9 | `MOVE_MEMBERS` | `mod.disconnectVoice` |
| 10 | `VIEW_AUDIT_LOG` | `auditLog.list` |
| 11 | `MANAGE_REPORTS` | `report.list / unresolvedCount / resolve` (+ `report.changed` recipient) |

**Owner-only, never delegable:** `guild.transferOwnership`, `guild.delete` (stay on
`requireGuildOwner`).

## Schema (all additive; `drizzle-kit push`)

- `guildRole.permissions` — integer, `notNull`, **default 0**. Plain JS number (12 bits).
- `guildRole.color` — text, nullable. `#rrggbb`; null = uncolored (no tint contribution).
- `guildMembership.serverMuted` — boolean integer, `notNull`, default `false`.
- **`report`** (new): `id` (ULID text PK — sort order), `guildId` (FK → guild, cascade),
  `channelId` (FK → channel, cascade), `messageId` (FK → message, **set null** — reports
  outlive hard-deleted messages), `messageAuthorId` (FK → user, cascade),
  `messageContent` (text, notNull — **snapshot at report time**, the record that survives
  deletion), `reason` (text, notNull, 1–500), `reporterId` (FK → user, cascade),
  `resolvedAt` (timestamp, nullable), `resolvedById` (text, nullable), `createdAt`.
  Index on `guildId`.
- **`auditLogEntry`** (new — ROADMAP shape): `id` (ULID text PK — the pagination cursor),
  `guildId` (FK → guild, cascade), `actorId` (text, notNull), `action` (text, notNull),
  `targetUserId` / `targetChannelId` / `targetMessageId` (text, nullable), `metadata`
  (text JSON, notNull, default `'{}'`), `createdAt`. Index on `guildId`.
  **Target columns and `actorId` carry NO foreign keys, deliberately** — audit entries are
  forensic records that must survive the deletion of what they reference (a mod-deleted
  message, a deleted channel); only `guildId` cascades (guild gone = log gone).

**Migration sequencing is a non-issue:** every change is additive with a safe default, so a
single `drizzle-kit push` lands it all; `@everyone` stays at `permissions: 0` for new AND
existing guilds — exactly behavior-preserving, since everything the 12 bits gate is
owner-only today (#47). No backfill; `createGuildWithOwner` seeding unchanged. The
push→generate switch remains a Phase 8 gate per the ROADMAP.

## Permission evaluation & gates — #47

**Computation — per-request, no cache.** Effective permissions = OR of the member's
`memberRole` → `guildRole` bitfields plus the guild's `isDefault` row, computed fresh per
gated request: one query (bitfields where `isDefault` OR id ∈ the member's `memberRole`
rows), OR'd in JS. Later escape hatches, in order: per-request memo, then a real cache.

**Two middleware factories, both plain `FORBIDDEN` (no-peek):**

- **`requireGuildPermission(bit)`** for `guildId`-keyed procedures, registered after
  `.input()`. Order inside: membership check first (FORBIDDEN if absent — non-members never
  inherit `@everyone` bits), owner short-circuit, then effective-bits check passing on
  `ADMINISTRATOR` or the required bit. **Subsumes `requireGuildMember`** — one middleware
  per gated procedure.
- **`requireChannelPermission(bit)`** for `channelId`-keyed procedures: load channel →
  FORBIDDEN if missing → FORBIDDEN if `guildId` null (no DM moderation) → membership +
  permission against `channel.guildId` → injects `context.channel`.

**Escalation guard (spec addition):** `role.update` may only *toggle* permission bits the
actor's own effective mask contains — otherwise a `MANAGE_ROLES` holder edits a below-role
to add `ADMINISTRATOR`, assigns it to themselves, and escalates. Owner and `ADMINISTRATOR`
are unaffected (their resolved mask is already all bits).

## Hierarchy (charter rules, Discord verbatim)

Higher `position` = higher rank; `@everyone` pinned at 0 (can't be renamed, repositioned,
deleted, or assigned; its bits ARE editable, gated `MANAGE_ROLES`). Acting on a member
(kick / ban / server-mute / voice-disconnect) requires the actor's highest role
**strictly above** the target's. `MANAGE_ROLES` manages and assigns only
**strictly-below** roles — assignment binds the ROLE, never the target (Discord verbatim):
any member may receive or lose a strictly-below role, the actor themselves and the owner
included. `ADMINISTRATOR` bypasses permission checks but **not** hierarchy. Owner bypasses
everything; the owner can never be targeted by the member-targeted acts above.

**Helpers — handler-level functions in `packages/db`, not middleware** (target ids arrive
under varying input names):

- `getHighestRolePosition(guildId, userId)` — max position over the member's roles,
  default 0 with none.
- `actorOutranksMember(guildId, actorId, targetId)` — owner rules folded in (target is
  owner → false; actor is owner → true), else strict `actorPos > targetPos` in one grouped
  query. Equal rank can't act; self-target always fails (strict inequality). Hierarchy
  failure throws the same plain FORBIDDEN.

UI shows an action if the *permission* allows it; a hierarchy miss surfaces as the server's
FORBIDDEN (no hierarchy-aware greying in v1 — #47).

## Procedures

Rate limits reuse `perUserRatelimit` (`packages/api/src/ratelimit.ts`). Two new rules:
**`reportCreate` 10 / hour** (invite-create pattern) and one shared **`modAction`
30 / 60 s** covering every mod + role mutation below (backstop against scripted abuse,
roomy for real moderation). No limiter on reads, per convention.

**New `role` router** (all `requireGuildPermission(MANAGE_ROLES)` + `modAction` limit):

| Procedure | In | Hierarchy | Notes |
| --- | --- | --- | --- |
| `role.create` | `{ guildId, name }` | — | Inserts at the **bottom** of the custom stack (position 1; existing custom roles shift up) — always strictly below the creator |
| `role.update` | `{ guildId, roleId, name?, color?, permissions? }` | role strictly below | @everyone: only `permissions` editable; escalation guard on toggled bits |
| `role.delete` | `{ guildId, roleId }` | role strictly below | Not @everyone; `memberRole` rows cascade |
| `role.reorder` | `{ guildId, roleId, direction: 'up' \| 'down' }` | **both** swapped roles strictly below | Adjacent swap (▲▼ UX); @everyone immovable |
| `role.assign` | `{ guildId, userId, roleId }` | role strictly below | Target must be a member — any member, self and the owner included |
| `role.unassign` | `{ guildId, userId, roleId }` | same as assign | |

**New `mod` router:**

| Procedure | In | Gate | Notes |
| --- | --- | --- | --- |
| `mod.deleteMessage` | `{ channelId, messageId, reason? }` | `requireChannelPermission(MANAGE_MESSAGES)` | No hierarchy (charter lists hierarchy for member-targeted acts only). Hard-deletes + publishes `message.deleted`; audits reason + content snippet. Own-message delete stays on `chat.deleteMessage` (author-only, unaudited) |
| `mod.serverMute` | `{ guildId, userId, muted }` | `requireGuildPermission(MUTE_MEMBERS)` + outranks | See §Server-mute |
| `mod.disconnectVoice` | `{ guildId, userId }` | `requireGuildPermission(MOVE_MEMBERS)` + outranks | Evicts the seat via the existing guild-scoped eviction (#42 path); `peerLeft` flows naturally |

**New `report` router:**

| Procedure | In | Gate | Notes |
| --- | --- | --- | --- |
| `report.create` | `{ messageId, reason }` | channel membership; **guild channels only** (DM → FORBIDDEN) | `reportCreate` limit; snapshots author + content; publishes `report.changed` |
| `report.list` | `{ guildId, resolved? }` | `requireGuildPermission(MANAGE_REPORTS)` | Newest-first; rows carry reporter, snapshot, resolution info |
| `report.unresolvedCount` | `{ guildId }` | same | Feeds the inbox badge |
| `report.resolve` | `{ guildId, reportId }` | same + `modAction` limit | Sets `resolvedAt` / `resolvedById` — **mark only**, no forced action; publishes `report.changed`; audited |

**New `auditLog` router:** `auditLog.list({ guildId, before?, limit })` —
`requireGuildPermission(VIEW_AUDIT_LOG)`; cursor-paginated by `id` DESC (ULID; the
`chat.history` pattern), default 50 / max 100; rows join actor display info.

**New `admin` router** (instance tier, `adminProcedure` — #50, #52):

- `admin.banUser({ userId, reason })` — **`reason` required non-empty** (kills Better
  Auth's `"No reason"` literal; the column is the sole paper trail — instance-ban is
  deliberately not audit-logged). Pre-guards: no self-ban, no banning another `admin`-role
  user (Better Auth doesn't prevent it), wrap `APIError`s (they'd surface as 500s through
  oRPC). Then, in order: `auth.api.banUser({ body, headers: context.headers })` — the
  calling admin's session headers are required, and it **revokes all the target's sessions
  itself** — → `leaveVoice(userId)` (instance-wide, idempotent) →
  `closeUserConnections(userId)` (new registry, below). Omit `banExpiresIn` ⇒ permanent.
  Never flip `banned` directly in the DB — that path revokes nothing.
- `admin.unbanUser({ userId })` — `auth.api.unbanUser`; no teardown needed. Restores,
  never erases: memberships / messages / guild bans were untouched by the ban.
- `admin.listBannedUsers()` — banned users + `banReason` for the admin UI.

**New connection registry — `packages/api/src/realtime/connections.ts`** (#50): the
presence pattern (`connectionOpened / connectionClosed` + `closeUserConnections(userId)`),
wired into the `websocket.open / close` handlers in `apps/server/src/index.ts`. Presence
tracks counts only; this holds the actual socket handles.

**Regated existing procedures** (owner-gate → permission gate; behavior-preserving at
`@everyone = 0`):

| Procedure | Old gate | New gate |
| --- | --- | --- |
| `channel.create / update / delete` | `requireGuildOwner` | `requireGuildPermission(MANAGE_CHANNELS)` |
| `guild.invite.create / list / revoke` | `requireGuildOwner` | `requireGuildPermission(MANAGE_INVITES)` |
| `guild.member.kick` | `requireGuildOwner` | `requireGuildPermission(KICK_MEMBERS)` + `actorOutranksMember` (replaces the self-target guard — owner-target and self-target both fail it) |
| `guild.member.ban` | `requireGuildOwner` | `requireGuildPermission(BAN_MEMBERS)` + `actorOutranksMember` |
| `guild.member.unban / banList` | `requireGuildOwner` | `requireGuildPermission(BAN_MEMBERS)` (no hierarchy — target isn't a member) |
| `guild.update` (new: rename) | — | `requireGuildPermission(MANAGE_GUILD)`; publishes `guild.updated` |

Unchanged: `guild.transferOwnership` / `guild.delete` (owner-only), `guild.member.leave`,
`guild.invite.consume`, `chat.*`, all reads gated `requireGuildMember` /
`requireChannelMember` today.

**`guild.get` grows** (#47): `viewer: { isOwner, permissions }` where `permissions` is the
**resolved mask** (owner or `ADMINISTRATOR` → all 12 bits — bypass logic lives only on the
server); `roles: [{ id, name, color, position, permissions, isDefault }]`; each member row
gains `roleIds` and `serverMuted`. The web gates every surface with one uniform
`hasPermission(viewer.permissions, bit)`.

## Server-mute — charter 5, #49

`serverMuted` lives on `guildMembership` and **persists across leave/join of voice, guild
switches, and server restarts** (rooms stay in-memory per ADR 0007; the flag doesn't).

- `mod.serverMute` writes the flag; if the target is seated anywhere in the guild, the
  server **authoritatively pauses their audio producers** (mic and screenAudio — a mute
  that leaves screenshare audio audible is toothless). No self-resume: `voice.produce` of
  kind `audio` while `serverMuted` creates the producer **server-side paused**, and fresh
  seats on `voice.join` apply the flag before any media flows.
- Unmute resumes paused audio producers (client re-produce not required).
- **Silent for the target** (#49): no toast — the locked mic button and the badge on their
  own tile are the signal (mod-action toasts are a harassment vector).
- Wire shape: `voice.snapshot` and `voice.peerJoined` seats grow `serverMuted`, so late
  subscribers and fresh joins render the badge without extra events.

## Realtime events — #49

Four new `RealtimeEvent` variants; granular *names*, coarse *reconciliation* — every new
event is invalidate-only except the seated server-mute case, which rides the existing
occupancy reducer. No audit-log events (forensic view, fresh on open, `staleTime: 0`); a
live tail is additive later. The reconnect path already invalidates everything — no
resume/replay handling needed.

| Event | Payload | Recipients | Client reconciliation |
| --- | --- | --- | --- |
| `role.changed` | `guildId` | all guild members | invalidate `guild.get` (create/update/delete/reorder collapse into one — the audit log records *what*, the event only *that*) |
| `member.rolesChanged` | `guildId`, `userId` | all guild members | invalidate `guild.get` — covers roster regrouping, name colors, the viewer's own gates |
| `voice.serverMuteSet` | `guildId`, `channelId \| null`, `userId`, `serverMuted` | all guild members | seated: `setQueryData` occupancy patch + `voiceSession` mic-lock when self; unseated (`channelId: null`): invalidate `guild.get` |
| `report.changed` | `guildId` | owner ∪ `ADMINISTRATOR` ∪ `MANAGE_REPORTS` holders, computed at publish time | invalidate report unresolved-count + list |

`report.changed` fires on **create and resolve** (resolve must decrement the other mods'
badges). It's the first *permission-derived* recipient set — a `packages/db` helper
(`listUsersWithPermission(guildId, bit)`, owner + `ADMINISTRATOR` folded in) computes it at
publish time; non-holders are simply absent, so gating is server-side, not client-filtered.

## Audit log — charter 7

`recordAuditEntry(...)` helper in `packages/db`, called from every privileged mutation
after it succeeds. "Back-fill" = instrument the existing procedures; history starts at
ship. **Not logged:** self-service actions (own edits/deletes, self mute/deaf, markRead),
joins/leaves, invite consumption, and **instance-ban** (instance-scoped, no guild home —
`banReason` is its record).

Action vocabulary + `metadata` JSON shapes (changed fields as `[old, new]` pairs):

| `action` | Target columns | `metadata` |
| --- | --- | --- |
| `member.kick` | `targetUserId` | `{}` |
| `member.ban` | `targetUserId` | `{ reason: string \| null }` |
| `member.unban` | `targetUserId` | `{}` |
| `member.serverMute` | `targetUserId` | `{ muted: boolean }` |
| `member.voiceDisconnect` | `targetUserId`, `targetChannelId` | `{}` |
| `message.modDelete` | `targetUserId` (author), `targetChannelId`, `targetMessageId` | `{ reason: string \| null, contentSnippet: string }` — snippet = first 200 chars; the only surviving record of a hard-deleted message |
| `role.create` | — | `{ roleId, name }` |
| `role.update` | — | `{ roleId, name, changed: { name?: [old, new], color?: [old, new], permissions?: [old, new] } }` |
| `role.delete` | — | `{ roleId, name }` |
| `role.reorder` | — | `{ roleId, name, from: number, to: number }` |
| `role.assign` / `role.unassign` | `targetUserId` | `{ roleId, name }` |
| `channel.create` | `targetChannelId` | `{ name, kind }` |
| `channel.update` | `targetChannelId` | `{ name: [old, new] }` |
| `channel.delete` | `targetChannelId` | `{ name }` |
| `guild.update` | — | `{ name: [old, new] }` |
| `guild.transferOwnership` | `targetUserId` (new owner) | `{}` |
| `invite.create` | — | `{ inviteId, code, expiresAt: string \| null }` |
| `invite.revoke` | — | `{ inviteId, code }` |
| `report.resolve` | — | `{ reportId }` |

## Instance-ban sign-in & session-death UX — #52

- **Zombie-tab fix (generic):** when the realtime socket fails to re-establish, the client
  re-checks the session (`authClient.getSession()`); gone → hard-navigate to `/login`
  (the sign-out mechanism). Lands a banned user on the sign-in screen within seconds and
  covers every other session-death cause. No hint banner — the client can't distinguish
  causes at that point; the sign-in attempt is where the explanation lives.
- **Sign-in:** set the admin plugin's `bannedUserMessage` to **"This account has been
  banned from this instance."** (static config string — no reason interpolation; the reason
  stays admin-only). Special-case `code === "BANNED_USER"` in the login form's `onError`
  into a **persistent inline error on the login card** (banned is durable state, not a
  transient failure); other errors keep the toast.

## UI surfaces — #48 (prototype `prototype/roles-ux-48`, capture-only)

**Guild settings dialog — permission-gated sections** (appear/disappear per
`viewer.permissions`, no locked placeholders; dialog entry visible iff ≥1 section passes —
no longer owner-only):

| Section | Visible with |
| --- | --- |
| Members | `KICK_MEMBERS` ∨ `BAN_MEMBERS` ∨ `MANAGE_ROLES` |
| Roles | `MANAGE_ROLES` |
| Bans | `BAN_MEMBERS` |
| Invites | `MANAGE_INVITES` |
| Reports | `MANAGE_REPORTS` (unresolved-count badge) |
| Audit log | `VIEW_AUDIT_LOG` |
| Danger zone (transfer / delete) | owner only |

- **Roles editor: master–detail** (variant A, refined `4e8d0c3`): fixed role list column
  (hover ▲▼ reorder), only the edit pane scrolls; name field; **preset swatch row + native
  custom color picker**; permission toggles grouped (General / Members / Messages) with
  one-line hints. @everyone selectable — bits editable, rename/reorder/delete disabled.
- **Assignment on member rows** (settings → Members): per-role chips with × to unassign,
  "+" popover to assign — replaces the static Owner/@everyone text; the owner keeps an
  "Owner" marker beside chips.
- **Member list panel: grouped by highest role** in rank order, roleless members last under
  "Members"; group headers and names tinted by the highest **colored** role (Discord rule);
  chat author names take the same tint. Presence stays the avatar dot — no online/offline
  buckets inside groups.
- **Mod actions in context menus:** member rows and voice occupant rows/tiles gain
  server-mute / disconnect / kick / ban items per the viewer's permissions (the existing
  per-peer volume menu grows). Server-muted peers show a distinct server-mute badge; the
  muted user's own mic button locks with an explanatory tooltip.
- **Mod message-delete:** deleting someone else's message opens a **confirm dialog with a
  preview of the message and an optional reason field** (reason → audit metadata). Own
  deletes keep today's flow.
- **Report flow:** "Report" action on message context menu (guild channels, any member) →
  dialog with required reason (1–500). Reports inbox lists snapshot, author, reporter,
  time; "Resolve" marks and greys the row; resolved reports live under a toggle.
- **Audit log view:** read-only paginated list (fresh on open), one row per entry — actor,
  action phrase, target, relative time; metadata rendered inline (e.g. role diffs).
- **Admin (instance) page:** ban form with **required reason**, banned-users list with
  reasons + unban.

## Rollout order (single push, then slices)

1. Schema push + `permissions.ts` catalog + evaluation/gates/hierarchy helpers +
   `guild.get` viewer mask (behavior-preserving: `@everyone = 0` denies exactly what
   owner-gates deny today).
2. Role procedures + roles editor + assignment chips + member-list grouping/tints.
3. Regate existing procedures + settings-section gating + audit instrumentation
   (`recordAuditEntry` + audit view).
4. Moderation: `mod.*` (server-mute incl. voice plumbing, disconnect, mod-delete) +
   `voice.serverMuteSet` + seat shape change.
5. Reports end-to-end.
6. Instance-ban: connection registry + `admin.*` + login-card error + zombie-tab fix.

Implementation lands as ordinary blocked-by-chained build issues (Phase 5 precedent
#20–#25), outside the map.

## Acceptance (extends ROADMAP Phase 6 verification)

- Owner creates roles, recolors, reorders, assigns; a second browser sees the member list
  regroup and names retint live (`role.changed` / `member.rolesChanged`).
- A `MANAGE_CHANNELS`-only member can rename channels but sees no Roles/Bans sections;
  their settings dialog reflects gates live after a role edit.
- Hierarchy: equal-rank kick attempt → FORBIDDEN; `MANAGE_ROLES` can't edit roles at or
  above their highest, can't toggle bits they lack.
- Server-mute: target's mic locks silently, badge shows for everyone, persists across
  voice rejoin and server restart; unmute restores audio without a rejoin.
- Reports: member reports a message; only permission holders see the badged inbox; resolve
  clears the badge on another mod's client; report survives message deletion.
- Every action in the audit table above appears in the audit view with its metadata.
- Instance-ban: banned user's tabs land on `/login` within seconds; re-login shows the
  persistent inline banned message; unban restores memberships/messages intact; banning
  another admin is rejected; reason is mandatory.
