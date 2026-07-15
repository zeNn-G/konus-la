# RBAC activation: permission bitfield, populated memberRole, position hierarchy

Amends [ADR 0004](0004-per-guild-authorization-custom-rbac-tables.md). The RBAC-shaped
tables Phase 2 shipped inert are **activated** in Phase 6: `guildRole` gains a
**`permissions` integer bitfield** (12 frozen bits) and a nullable `color`; the
always-empty `memberRole` is **populated** (multi-role — effective permissions = OR of the
member's bitfields plus `@everyone`'s; highest `position` drives hierarchy); and the
planned **"admin tier" is replaced by permission bits** — there is no Admin role, enum, or
flag, only roles holding bits. Full detail in the
[Phase 6 spec](../specs/phase-6-roles-and-moderation.md); charted on wayfinder map
[#46](https://github.com/zeNn-G/konus-la/issues/46).

## Context

ADR 0004 deferred "the RBAC work" with a predicted shape: "add a `permissions` bitfield to
`guildRole`, populate the empty `memberRole`, add `setRole` + an admin tier." The first two
land exactly as designed. The third is amended: grilling settled on Discord-style
delegation (custom roles + bitfield + hierarchy), which makes a distinguished admin *tier*
redundant — `ADMINISTRATOR` is bit 0, and any role can carry any subset of the 12 bits.
`setRole` accordingly becomes `role.assign` / `role.unassign` (multi-role, not a single
role slot). The ROADMAP's older "Owner / Admin / Member single enum on `GuildMembership`"
was never implemented and is superseded outright.

Load-bearing rules:

- **Hierarchy is Discord's, verbatim:** higher `position` outranks; `@everyone` pinned at
  0, unassignable and undeletable but with editable bits; member-targeted actions require
  strictly higher rank; `MANAGE_ROLES` touches only strictly-below roles; `ADMINISTRATOR`
  bypasses permission checks but never hierarchy.
- **Ownership stays `guild.ownerId` only** (unchanged from ADR 0004): the owner bypasses
  everything, and transfer/delete remain owner-only, never delegable via bits.
- **`@everyone` defaults to `permissions: 0`** for new and existing guilds — every gated
  action is owner-only today, so activation is exactly behavior-preserving at migration
  time; delegation is always an explicit act.
- **Evaluation is per-request, uncached**, exposed to clients as a resolved mask on
  `guild.get` (`viewer.permissions`; owner/`ADMINISTRATOR` → all bits) so bypass logic
  lives only on the server.
- **No per-channel permission overwrites** — a guild-wide bitfield is the whole model in
  v1; overwrites stay parked post-v1.

## Consequences

- The Phase 2 bet paid out: activation is purely additive (two columns on `guildRole`, one
  flag on `guildMembership`, two new tables for audit/reports) — no reshaping, no backfill.
- ADR 0002's two tiers stand: the instance tier (`adminProcedure`, Better Auth `role:
  'admin'`) is untouched; this ADR only fills in the per-guild tier.
- `requireGuildOwner` survives only on transfer/delete; everything else privileged moves to
  `requireGuildPermission(bit)` / `requireChannelPermission(bit)`, which subsume the
  membership gates.
- The bit order is frozen forever (append-only) — bitfields are persisted integers, so
  reordering would silently re-permission every role.
- A reader finding ROADMAP/ADR 0004 language about an "admin tier" or role enum should
  treat this ADR as the correction; that reversal is intentional and recorded here.
