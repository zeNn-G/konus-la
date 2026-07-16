import { and, eq, inArray, max, or, sql } from "drizzle-orm";

import { db } from "../index";
import { guild, guildMembership, guildRole, memberRole } from "../schema/guild";

/**
 * Membership + ownership in one query — the permission gates' first step. Returns `null`
 * when the caller isn't a member (unknown guilds included, driving the no-peek FORBIDDEN).
 */
export async function getMemberAccess(
  guildId: string,
  userId: string,
): Promise<{ isOwner: boolean } | null> {
  const [row] = await db
    .select({ ownerId: guild.ownerId })
    .from(guildMembership)
    .innerJoin(guild, eq(guildMembership.guildId, guild.id))
    .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { isOwner: row.ownerId === userId };
}

/**
 * Effective permission bits for a MEMBER of a guild: the OR of the `@everyone` row
 * (`isDefault`) and every role assigned via `memberRole`. One query, OR'd in JS —
 * computed fresh per gated request, never cached (ADR 0008).
 *
 * Callers must have verified membership first: this reads role rows only, so a
 * non-member would still receive the `@everyone` bits. Raw integers only — bit meaning
 * lives in `@konus-la/api/permissions`.
 */
export async function getEffectivePermissions(guildId: string, userId: string): Promise<number> {
  const rows = await db
    .select({ permissions: guildRole.permissions })
    .from(guildRole)
    .where(
      and(
        eq(guildRole.guildId, guildId),
        or(
          eq(guildRole.isDefault, true),
          inArray(
            guildRole.id,
            db
              .select({ roleId: memberRole.roleId })
              .from(memberRole)
              .where(and(eq(memberRole.guildId, guildId), eq(memberRole.userId, userId))),
          ),
        ),
      ),
    );
  return rows.reduce((mask, row) => mask | row.permissions, 0);
}

/**
 * The members whose effective mask intersects `bits`, plus the owner ALWAYS — the
 * permission-derived recipient set for events like `report.changed`, computed fresh at
 * publish time (Phase 6 spec). Raw integers only: callers OR the `ADMINISTRATOR` bit into
 * `bits` themselves — bit meaning lives in `@konus-la/api/permissions`, not here.
 *
 * When the `@everyone` row itself carries an intersecting bit, every member qualifies —
 * answered without walking assignments.
 */
export async function listUsersWithPermission(guildId: string, bits: number): Promise<string[]> {
  const [guildRow] = await db
    .select({ ownerId: guild.ownerId })
    .from(guild)
    .where(eq(guild.id, guildId))
    .limit(1);
  if (!guildRow) return [];

  const [defaultRole] = await db
    .select({ permissions: guildRole.permissions })
    .from(guildRole)
    .where(and(eq(guildRole.guildId, guildId), eq(guildRole.isDefault, true)))
    .limit(1);
  if (((defaultRole?.permissions ?? 0) & bits) !== 0) {
    const members = await db
      .select({ userId: guildMembership.userId })
      .from(guildMembership)
      .where(eq(guildMembership.guildId, guildId));
    return members.map((row) => row.userId);
  }

  const holders = await db
    .selectDistinct({ userId: memberRole.userId })
    .from(memberRole)
    .innerJoin(guildRole, eq(memberRole.roleId, guildRole.id))
    .where(
      and(eq(memberRole.guildId, guildId), sql`(${guildRole.permissions} & ${bits}) != 0`),
    );
  const userIds = new Set(holders.map((row) => row.userId));
  userIds.add(guildRow.ownerId);
  return [...userIds];
}

/**
 * Highest role position a member holds — max over their `memberRole` rows, `0` with none
 * (`@everyone` is pinned at 0). Higher position = higher rank (charter rules).
 */
export async function getHighestRolePosition(guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ position: max(guildRole.position) })
    .from(memberRole)
    .innerJoin(guildRole, eq(memberRole.roleId, guildRole.id))
    .where(and(eq(memberRole.guildId, guildId), eq(memberRole.userId, userId)));
  return row?.position ?? 0;
}

/**
 * Whether `actorId` may act on `targetId` (kick / ban / mute / disconnect / role-assign).
 * Charter rules, owner cases folded in: the target being the owner always loses (the
 * owner can never be targeted — including by themselves), the actor being the owner
 * always wins, otherwise strict `actorPos > targetPos` in one grouped query. Strict
 * inequality makes equal rank AND self-target fail with no special-casing.
 */
export async function actorOutranksMember(
  guildId: string,
  actorId: string,
  targetId: string,
): Promise<boolean> {
  const [guildRow] = await db
    .select({ ownerId: guild.ownerId })
    .from(guild)
    .where(eq(guild.id, guildId))
    .limit(1);
  if (!guildRow) return false;
  if (targetId === guildRow.ownerId) return false;
  if (actorId === guildRow.ownerId) return true;

  const rows = await db
    .select({ userId: memberRole.userId, position: max(guildRole.position) })
    .from(memberRole)
    .innerJoin(guildRole, eq(memberRole.roleId, guildRole.id))
    .where(and(eq(memberRole.guildId, guildId), inArray(memberRole.userId, [actorId, targetId])))
    .groupBy(memberRole.userId);

  const positionOf = (userId: string) =>
    rows.find((row) => row.userId === userId)?.position ?? 0;
  return positionOf(actorId) > positionOf(targetId);
}
