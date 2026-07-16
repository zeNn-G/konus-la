# Auth

Better Auth instance configured for the project. Handles sign-in, sessions, cookies, and (when added) OAuth providers. Authentication only — authorization rules live in API procedures.

## Plugins & fields

- **admin plugin** (instance tier, [ADR 0002](../../docs/adr/0002-two-tier-authorization.md)): adds `role` / `banned` / `banReason` / `banExpires` to `user` and `impersonatedBy` to `session`. Configured with `bannedUserMessage: "This account has been banned from this instance."` — a **static string by design** (no reason interpolation; the reason stays admin-only), which the login form pins to the card off the `BANNED_USER` error code. Ban/unban go through `auth.api.banUser/unbanUser` in the API's `admin` router — never direct DB writes, which would revoke nothing.
- **`api-error` subpath** (`@konus-la/auth/api-error`) re-exports Better Auth's `APIError` so consumers can `instanceof`-narrow its failures without a direct better-auth dependency (isolated installs keep better-auth resolvable only from this package). It lives outside index so tests that mock the configured `auth` instance — or environments without its env vars — can still import the real class.
- **`username`** is a Better Auth `additionalField` (`input: true`), **not** the Better Auth username _plugin_ (which would enable username sign-in — the glossary rejects that).

## Signup wrapping (Phase 1, [ADR 0003](../../docs/adr/0003-phase1-auth-hooks.md))

The invite-code gate is implemented with Better Auth hooks, not a custom ORPC procedure, so the native cookie/session flow is untouched:

- `databaseHooks.user.create.before` — first account on a fresh instance (zero users) gets `role: 'admin'` (the Instance Owner); everyone else `role: 'user'`.
- `databaseHooks.user.update.before` — strips `username` from any update payload (immutability). Note Better Auth _merges_ a hook's returned `data`, so removal must mutate the payload in place.
- `hooks.before` on `/sign-up/email` — validates + normalises the username (regex, reserved list, uniqueness) and, when users already exist, requires a usable signup code read from the `x-signup-code` **header** (not a body field — it isn't a `user` column).
- `hooks.after` on `/sign-up/email` — consumes the code (`usedAt` + `usedByUserId`) once the account exists.

All DB access goes through `@konus-la/db` query helpers; this package does not depend on `drizzle-orm`.
