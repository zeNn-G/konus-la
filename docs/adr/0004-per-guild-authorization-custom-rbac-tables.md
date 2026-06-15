# Per-guild authorization: custom RBAC-shaped tables

Per-guild authorization — the tier [ADR 0002](0002-two-tier-authorization.md) deferred to Phase 2 — is
built from **custom Drizzle tables + ORPC procedures + an API-layer access tier**, _not_ the Better Auth
**organization plugin**. The schema is **RBAC-shaped** (`guild`, `guildRole`, `guildMembership`,
`memberRole`) but Phase 2 ships only **owner + member** behavior.

## Context

This deliberately reverses two earlier written positions:

- ADR 0002 named the **organization plugin** as the leading per-guild candidate. Rejected: its invitations
  are **email-targeted**, which contradicts the ROADMAP's **shareable invite-code** model, and its
  `activeOrganization` / schema concepts fight the guild domain language.
- The ROADMAP's Phase 2 line said "no custom roles / single enum on membership." We build RBAC-shaped tables
  now so custom roles become a purely additive change later. The ROADMAP is treated as direction, not contract.

Three load-bearing model decisions:

- **Ownership is `Guild.ownerId` only**, never a role row. This gives a single source of truth, a
  schema-level "exactly one owner" guarantee, and a cheap "guilds I own" query (which the
  `MAX_GUILDS_PER_USER` cap counts). The owner's elevated power is an `if (userId === guild.ownerId)`
  short-circuit; transfer is a one-column `ownerId` update and the old owner stays an ordinary member.
- **`@everyone` is implicit.** Each guild seeds exactly one `guildRole` (`isDefault: true`). Membership
  _alone_ means `@everyone` — **no `memberRole` row** is written for it, so `memberRole` is empty in Phase 2
  (it is the future home for custom-role assignments).
- **No admin tier in Phase 2.** All management is **owner-gated** (`requireGuildOwner`); admin delegation and
  `setRole` are deferred to the RBAC work.

Invites are **time-only**: `expiresAt` (a duration → timestamp, or `null` = infinite) is the only enforced
limit. `usedCount` is display-only (no max-uses cap); revoke hard-deletes. A **GuildBan** beats an invite
(checked inside `consumeInvite`).

## Consequences

- Hard to reverse — this is schema. The RBAC-shaped tables make the deferred work additive (add a
  `permissions` bitfield to `guildRole`, populate the empty `memberRole`, add `setRole` + an admin tier),
  with no reshaping.
- A reader who finds the organization plugin referenced in ADR 0002's "leading candidate" will see this
  contradicts it; that reversal is intentional and recorded here.
- Per-guild checks live at the API layer as `requireGuildMember` / `requireGuildOwner` middlewares (see
  `packages/api`), gating on a `guildId` from validated input — never in Better Auth.
