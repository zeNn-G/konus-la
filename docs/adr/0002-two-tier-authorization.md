# Two-tier authorization: instance-wide vs per-guild

Authorization splits into two independent tiers:

- **Instance-wide** — owning the instance, minting signup codes, and banning a user from the *entire* instance. This uses the Better Auth **admin plugin**: the global `role` field (the Instance Owner has `admin`) and the plugin's `banned` / `banExpires` fields + ban endpoints.
- **Per-guild** — Owner / Admin / Member *within a single guild*. This is explicitly **not** modeled by the admin plugin's global roles, because the same user holds different roles in different guilds. It is a separate tier checked at the API layer.

The concrete per-guild mechanism is **deferred to Phase 2**. Leading candidate: the Better Auth **organization plugin** (Guild = organization, members carry per-organization roles, guild invites = organization invitations). Fallbacks: a custom `GuildMembership` table or `createAccessControl` roles.

## Consequences

- The global `admin` role is reserved for the Instance Owner only; a Guild Admin never carries it.
- Phase 1 only needs the instance tier (admin plugin). Nothing about Phase 1 presupposes which per-guild mechanism Phase 2 picks.
