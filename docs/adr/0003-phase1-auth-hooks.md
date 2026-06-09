# Phase 1 auth extension via Better Auth hooks + additional fields

The invite-code signup gate, the first-user-becomes-Instance-Owner bootstrap, and the immutable
`username` are implemented **inside Better Auth** — through its `hooks` and `databaseHooks` plus a
`username` _additional field_ — rather than through a custom ORPC `auth.signup` procedure.

## Context

`packages/auth/CONTEXT.md` says authorization rules live in the API procedures, so a reader might expect
signup-code validation to live there too. It doesn't, and that is a deliberate trade-off worth recording.

A custom ORPC `auth.signup` procedure could wrap code-validation, code-consumption, and user-creation in a
single DB transaction (strong atomicity). But it would then have to call `auth.api.signUpEmail` server-side
and manually propagate Better Auth's `Set-Cookie` header back through the ORPC fetch response — re-implementing
the session/cookie handling that the native `/sign-up/email` endpoint does for free.

We chose the Better Auth hooks instead:

- The client calls `authClient.signUp.email(...)` directly; cookies/session are handled natively.
- `hooks.before` on `/sign-up/email` validates the username and the signup code; `hooks.after` consumes
  the code once the user exists; `databaseHooks.user.create.before` assigns the owner/admin role.
- The signup code travels as the **`x-signup-code` header**, not a body field, because it is not a `user`
  column — this keeps the typed `signUp.email` client clean and survives Better Auth stripping unknown body keys.
- `username` is a Better Auth **additional field** (`input: true`), not the Better Auth **username plugin**,
  which would enable username-based sign-in that the domain explicitly rejects ("Not a sign-in identifier").
  Immutability is enforced by a `databaseHooks.user.update.before` that **mutates the payload to delete
  `username`** — Better Auth merges a hook's returned `data`, so a field cannot be removed by returning it.

## Consequences

- Code validation and consumption are split across the `before`/`after` hooks rather than one transaction, so
  two concurrent signups racing the same single-use code have a small window. Consumption uses a conditional
  `WHERE usedAt IS NULL` update, and for a ~100-user friends instance this race is acceptable (consistent with
  [ADR 0001](0001-invite-gated-signup-first-user-owner.md)).
- Signup logic lives in `@konus-la/auth`, not the ORPC layer. A future maintainer looking for it in
  `packages/api` won't find it — hence this record.
- Reversible: swapping to a custom ORPC procedure later is possible but would require taking over cookie
  propagation, so it is not a trivial change.
