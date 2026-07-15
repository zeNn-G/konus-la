import type { AppRouterClient } from "@konus-la/api/routers/index";

type GuildView = Awaited<ReturnType<AppRouterClient["guild"]["get"]>>;
export type GuildRole = GuildView["roles"][number];

/**
 * Role-derived member facts, shared by the members panel (grouping), the settings chips
 * (rank-ordered display), and chat author names (tint). All of them lean on `guild.get`
 * returning roles highest-rank first with `@everyone` (position 0) last, so "first held
 * role in list order" IS "highest held role" — no sorting here.
 */

/** The member's held custom roles, highest rank first. `@everyone` is held by everyone
 *  and never listed. */
export function memberRolesOf(roles: GuildRole[], roleIds: string[]): GuildRole[] {
  return roles.filter((role) => !role.isDefault && roleIds.includes(role.id));
}

/** The member's highest custom role — what the members panel groups by. Null = roleless. */
export function highestRoleOf(roles: GuildRole[], roleIds: string[]): GuildRole | null {
  return memberRolesOf(roles, roleIds)[0] ?? null;
}

/**
 * The member's name tint: the highest COLORED role's color (Discord rule — uncolored
 * roles contribute no tint, the search continues below them). Null = default text color.
 */
export function roleColorOf(roles: GuildRole[], roleIds: string[]): string | null {
  return memberRolesOf(roles, roleIds).find((role) => role.color !== null)?.color ?? null;
}
