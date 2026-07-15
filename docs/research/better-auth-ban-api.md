# Better Auth admin-plugin ban & session revocation API (ticket #50)

Research for the instance-ban feature (Phase 6 moderation). All Better Auth claims verified
against **v1.6.11** — the version pinned in the root `package.json` catalog and the version
actually installed at `packages/auth/node_modules/better-auth` (checked: `"version": "1.6.11"`).
Two independent verifications were used: the installed dist (`dist/plugins/admin/*.mjs`) and the
raw source at the `v1.6.11` tag of `github.com/better-auth/better-auth`
(`packages/better-auth/src/plugins/admin/`). They agree on every claim below.

Repo context: `admin()` is registered with **no options** ([packages/auth/src/index.ts:115]),
so every plugin default named below applies to us as-is.

---

## 1. Server-side call shape

Yes — `auth.api.banUser` / `auth.api.unbanUser`. The source JSDoc states it explicitly
("**server:** `auth.api.banUser`", routes.ts L893–907 at v1.6.11).

| | Endpoint | `auth.api` method | Body |
|---|---|---|---|
| Ban | `POST /admin/ban-user` | `auth.api.banUser` | `userId: string` (required), `banReason?: string`, `banExpiresIn?: number` (**seconds**) |
| Unban | `POST /admin/unban-user` | `auth.api.unbanUser` | `userId: string` |
| Revoke only | `POST /admin/revoke-user-sessions` | `auth.api.revokeUserSessions` | `userId: string` |

Source: `dist/plugins/admin/routes.mjs` L365–467 (installed 1.6.11);
<https://raw.githubusercontent.com/better-auth/better-auth/v1.6.11/packages/better-auth/src/plugins/admin/routes.ts>;
docs: <https://better-auth.com/docs/plugins/admin>.

Naming trap: the **body** param is `banExpiresIn` (number of seconds); `banExpires` (a `Date`)
is the **DB column** it computes. Our schema already models it correctly as `timestamp_ms`
([packages/db/src/schema/auth.ts:22]).

**Headers/session context.** Every admin endpoint runs `adminMiddleware`
(routes.mjs L16–20):

```js
const adminMiddleware = createAuthMiddleware(async (ctx) => {
  const session = await getSessionFromCtx(ctx);
  if (!session) throw APIError.fromStatus("UNAUTHORIZED");
  return { session };
});
```

so the server-side call **must** carry a real admin session's headers:

```ts
await auth.api.banUser({
  body: { userId, banReason },   // banReason optional; omit banExpiresIn for permanent
  headers: context.headers,       // the calling admin's request headers (session cookie)
});
```

Inside our `adminProcedure` handlers `context.headers` is exactly that
([packages/api/src/index.ts:37]; headers enter context in [packages/api/src/context.ts]).
There is **no server-authority bypass** in 1.6.11 — no API-key/trusted-server path; the only
relaxation is the `adminUserIds` option, which still requires that user's session. Acting
without a session would mean writing the `banned/banReason/banExpires` columns via our own DB
layer and deleting sessions ourselves. We don't need that: the ban procedure is admin-initiated.

**Authorization inside the handler**: after the session check, `hasPermission` requires the
*caller's* role to grant `user: ["ban"]` — default `adminRoles: ["admin"]` — else
403 `YOU_ARE_NOT_ALLOWED_TO_BAN_USERS`. This matches our `adminProcedure` gate
(`role === "admin"`), so the plugin check is redundant-but-consistent for us.

**Handler-thrown errors to pre-empt** (they surface as better-auth `APIError`s, which our oRPC
handler would otherwise map to 500 INTERNAL — pre-validate in the procedure or wrap the call):

- 404 `USER_NOT_FOUND` — unknown `userId` (routes.mjs L457)
- 400 `YOU_CANNOT_BAN_YOURSELF` — self-ban (routes.mjs L458)
- Not prevented by the plugin: **banning another admin**. `hasPermission` checks only the
  caller. v1 has a single Instance Owner so this can't bite yet, but the procedure should
  guard `target.role !== "admin"` anyway.
- `unbanUser` has **no existence or is-banned pre-check** in 1.6.11 — it just runs
  `updateUser` (routes.mjs L397–411). Pre-check the target if we want a clean NOT_FOUND.

Return value of both: `{ user }` (the updated user row).

## 2. Session revocation semantics

**`banUser` revokes all of the user's sessions itself** — no separate `revokeUserSessions`
call is needed. From the installed handler (routes.mjs L459–466; identical at the v1.6.11 tag):

```js
const user = await ctx.context.internalAdapter.updateUser(ctx.body.userId, {
  banned: true,
  banReason: ctx.body.banReason || opts?.defaultBanReason || "No reason",
  banExpires: ctx.body.banExpiresIn ? getDate(ctx.body.banExpiresIn, "sec")
            : opts?.defaultBanExpiresIn ? getDate(opts.defaultBanExpiresIn, "sec")
            : void 0,
  updatedAt: new Date(),
});
await ctx.context.internalAdapter.deleteSessions(ctx.body.userId);  // ← revocation
```

`auth.api.revokeUserSessions` exists separately (same `deleteSessions` call, gated on
`user: ["revoke-session"]`) for revoke-without-ban.

**How the banned user's requests fail afterwards.** Two distinct mechanisms — and note that
`banned` is **never checked on session fetch** in 1.6.11 (grep of the whole dist: `banned`
appears only under `plugins/admin/`; the GitHub-tag `api/routes/session.ts` has zero hits):

1. **Existing sessions**: deleted by `banUser`, so `auth.api.getSession({ headers })` returns
   `null`. Our `requireAuth` therefore throws **`ORPCError("UNAUTHORIZED")`**
   ([packages/api/src/index.ts:18–31]) — the banned user looks simply logged-out to our API.
   The WS upgrade check fails the same way with a 401 ([apps/server/src/index.ts:80–83]).
2. **New sign-in attempts**: blocked by the plugin's `databaseHooks.session.create.before`
   hook (admin.mjs L33–54): throws **403 FORBIDDEN with `code: "BANNED_USER"`** and
   `message` = `bannedUserMessage` option (default: *"You have been banned from this
   application. Please contact support if you believe this is an error."*). OAuth callback
   paths get a redirect to the error URL with `?error=banned&…` instead (moot for us —
   email/password only).

Consequence: **`BANNED_USER` only ever surfaces on sign-in**, never through `requireAuth`.
If the web client wants to show "you are banned" rather than a generic logout, that message
comes from the failed re-login, not from our middleware.

Caveat: if `banned=true` were flipped directly in the DB without deleting sessions, existing
sessions in 1.6.11 **keep working** (the check only runs at session creation). Always go
through `auth.api.banUser`, or pair a manual write with session deletion.

## 3. `banReason` / `banExpires` semantics

From the handler quoted above plus `getDate` (`dist/utils/date.mjs`:
`new Date(Date.now() + span * 1000)` for `"sec"`):

- **Omitting `banExpiresIn` ⇒ permanent.** `banExpires` is left `undefined` (never written);
  the types say it outright: *"Number of seconds until the ban expires — By default, the ban
  never expires"* (types.ts L38–43 at v1.6.11). Confirmed for our v1 permanent-ban plan.
- **If set**: `banExpires = now + banExpiresIn seconds` (a `Date`, stored per our schema as
  `timestamp_ms`).
- **`banReason` default chain**: `body.banReason || defaultBanReason || "No reason"` — we pass
  no options, so an omitted reason is stored as the literal string `"No reason"`. If we want
  `null`-means-no-reason (as guild bans do, [packages/api/src/routers/guild.ts:217]), either
  set `defaultBanReason` or treat `"No reason"` as the sentinel in the admin UI.
- **`unbanUser` clears everything**: `{ banned: false, banExpires: null, banReason: null,
  updatedAt: new Date() }` (routes.mjs L405–410).
- **Expired temp bans auto-lift, but lazily**: the `session.create.before` hook compares
  `banExpires < now` at the next **sign-in attempt**, flips the DB back
  (`banned: false, banReason: null, banExpires: null`) and lets the sign-in through
  (admin.mjs L37–44). Nothing lifts it on read paths — the row stays `banned=true` until the
  user tries to log in. Ban lists must therefore treat `banned && banExpires < now` as
  not-banned if we ever use temp bans.
- Edge (re-ban without intervening unban): `banExpires: void 0` in the update means the column
  is *not touched*, so a leftover expiry from a previous temp ban would survive a new
  "permanent" ban. Irrelevant while v1 is permanent-only (unban always nulls it), but worth a
  guard if temp bans ever land.

## 4. Teardown hook points in this repo

What a successful `auth.api.banUser` does NOT do: it kills DB session rows only. Three live
resources survive it and need explicit teardown:

1. **Open WebSockets** keep streaming: `realtime.events` re-checks the session only **at
   subscription start** ([packages/api/src/routers/realtime.ts:16] — "`requireAuth` runs on
   this call, which IS the session re-check"); after that the generator pumps the publisher
   iterator until the socket closes. A banned user's open tab stays live indefinitely.
2. **Voice seat**: in-memory, keyed by userId ([packages/api/src/voice/rooms.ts:105–107]).
   Merely closing the socket does *not* free it — the `websocket.close` hook routes into
   `voiceConnectionClosed` → `startGrace`, a 30 s grace window
   ([apps/server/src/index.ts:138–143], [packages/api/src/voice/rooms.ts:582–591]).
3. **Presence**: derived from socket counts; resolves itself once the sockets close
   (debounced offline broadcast, [packages/api/src/realtime/presence.ts:45–61]).

**Recommended hook point: the instance-ban oRPC procedure itself**, in `packages/api`,
immediately after the `auth.api.banUser` call succeeds. The dependency direction forces this:
`packages/api` imports `@konus-la/auth`, never the reverse, so a Better Auth `hooks.after` on
`/admin/ban-user` inside `packages/auth` cannot reach `leaveVoice` or the realtime layer.
It also matches the repo's existing precedent — guild kick/ban/leave do
row-change → `evictMemberFromGuildVoice` → publish, inline in the procedure
([packages/api/src/routers/guild.ts:194–236]).

Sequence for the new `adminProcedure` ban handler:

```
1. pre-checks (target exists, target.role !== "admin", target !== self → clean ORPC errors)
2. await auth.api.banUser({ body: { userId }, headers: context.headers })
   → sets banned/banReason/banExpires + deletes ALL session rows
3. await leaveVoice(userId)          // packages/api/src/voice/rooms.ts:511 — instance-wide,
                                     // immediate peerLeft, idempotent, handles grace seats
4. closeUserConnections(userId)      // NEW — see below
```

Ordering notes:
- `leaveVoice` **before** closing sockets: deterministic immediate seat removal + `peerLeft`
  fan-out, instead of riding the close-triggered 30 s grace. (Calling it after would still
  work — `removeSeat` clears grace timers and `leaveVoice` finds grace seats — but the
  peerLeft would then race the grace machinery for no benefit.)
- Use `leaveVoice`, **not** `evictMemberFromGuildVoice`: the latter is deliberately
  guild-scoped ([packages/api/src/voice/rooms.ts:527–530]); an instance ban must vacate the
  seat wherever it is. `leaveVoice` is already exported from rooms.ts (though not yet
  re-exported from `packages/api/src/index.ts` — the ban procedure lives inside the package,
  so it imports from `../voice/rooms` directly, like guild.ts does).
- An instance ban does not delete guild-membership rows, so the banned user is still in the
  `peerLeft` recipient set — harmless; their sockets die in step 4.

**The missing piece: a per-user socket registry.** Nothing today can close a user's sockets:
presence tracks *counts*, not handles ([packages/api/src/realtime/presence.ts:16]), and the
publisher is fan-out-only. Recommendation: a small `packages/api/src/realtime/connections.ts`
following the exact presence pattern (module state in `packages/api`, thin hooks called from
the socket layer — the rationale comment at presence.ts:6–9 applies verbatim):

- `connectionOpened(userId, connectionId, close: () => void)` / `connectionClosed(userId, connectionId)`
  maintaining `Map<userId, Map<connectionId, close>>`;
- `closeUserConnections(userId)` invoking each registered `close`;
- wired in the `websocket.open` / `close` handlers in [apps/server/src/index.ts:126–144],
  where `ws.data` already carries both `userId` and `connectionId` (WSData, L60–65) and
  `ws.close()` is in scope. Closing the socket then cascades through the existing close hook
  (`wsHandler.close` aborts the subscription signal; presence debounce fires; the voice hook
  no-ops because step 3 already removed the seat).

Reconnection is already sealed with zero new code: the WS upgrade re-runs
`auth.api.getSession` (401, [apps/server/src/index.ts:80–83]) and every RPC hits `requireAuth`
(UNAUTHORIZED) — both fail because the session rows are gone.

`unban` needs no teardown at all: `auth.api.unbanUser({ body: { userId }, headers })` clears
the three columns; the user just logs in again.

## Version drift (1.6.11 → latest)

Latest stable at research time: **1.6.23** (plus `1.7.0-rc.1`) — <https://www.npmjs.com/package/better-auth>.
Full diff of the admin plugin between the two tags:

- **ban/unban/revoke endpoints byte-identical** — no param renames, same defaults, same
  in-handler `deleteSessions`. Everything above holds on 1.6.23.
- `adminMiddleware` now uses `getAuthoritativeSessionFromCtx` (DB-backed lookup, ignoring
  cookie cache). No effect on us (no `cookieCache` configured).
- The OAuth-callback redirect branch of the banned check was removed — banned sign-ins get the
  403 `BANNED_USER` on all paths. No effect (email/password only).
- `adminUpdateUser` hardened: setting `banned/banReason/banExpires` through it now requires
  the `user: ["ban"]` permission and `banned: true` also revokes sessions. In 1.6.11 those
  fields pass through `/admin/update-user` **without** revocation — one more reason to ban
  exclusively via `auth.api.banUser`.
- New error codes: `YOU_ARE_NOT_ALLOWED_TO_SET_USERS_EMAIL`,
  `PASSWORD_CANNOT_BE_UPDATED_VIA_UPDATE_USER`.

## Reference: plugin options & error codes (v1.6.11)

Options (all unset in our `admin()` call): `defaultBanReason` (fallback literal `"No reason"`),
`defaultBanExpiresIn` (seconds; unset = never expires), `bannedUserMessage` (default quoted in
§2), `adminRoles` (default `["admin"]`), `adminUserIds`, `defaultRole` (default `"user"`).

Error codes (`dist/plugins/admin/error-codes.mjs`): `BANNED_USER`,
`YOU_ARE_NOT_ALLOWED_TO_BAN_USERS`, `YOU_CANNOT_BAN_YOURSELF`,
`YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS` (and the other admin-CRUD codes). Note the
runtime 403 on a banned sign-in carries code `"BANNED_USER"` with `bannedUserMessage` as the
message — not the `ADMIN_ERROR_CODES.BANNED_USER` string.

## Sources

- Installed package (authoritative for our pinned version):
  `packages/auth/node_modules/better-auth/dist/plugins/admin/{admin,routes,error-codes,schema}.mjs`, `dist/utils/date.mjs` (`"version": "1.6.11"`)
- GitHub tag v1.6.11: `packages/better-auth/src/plugins/admin/{admin,routes,error-codes,types,schema}.ts`
  (<https://github.com/better-auth/better-auth/tree/v1.6.11/packages/better-auth/src/plugins/admin>)
- Docs: <https://better-auth.com/docs/plugins/admin>
- npm (version check): <https://www.npmjs.com/package/better-auth>
- Repo files cited inline: `packages/auth/src/index.ts`, `packages/api/src/index.ts`,
  `packages/api/src/routers/{realtime,guild}.ts`, `packages/api/src/realtime/{presence,publisher,publishers}.ts`,
  `packages/api/src/voice/rooms.ts`, `apps/server/src/index.ts`, `packages/db/src/schema/auth.ts`
