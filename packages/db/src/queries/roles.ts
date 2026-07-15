import { and, desc, eq, gt, lt, sql } from "drizzle-orm";

import { db } from "../index";
import { guildRole, memberRole } from "../schema/guild";

/**
 * Role CRUD for the `role` router (ADR 0008). Positions: higher = higher rank, `@everyone`
 * pinned at 0. Deletes leave gaps — ordering is relative, nothing renumbers. Hierarchy and
 * escalation checks live in the router; this module only moves rows.
 */

/** One role scoped to its guild — the router's lookup for hierarchy/@everyone checks. */
export async function getGuildRole(guildId: string, roleId: string) {
  const [row] = await db
    .select()
    .from(guildRole)
    .where(and(eq(guildRole.guildId, guildId), eq(guildRole.id, roleId)))
    .limit(1);
  return row ?? null;
}

/** Patch a role's name / color / permissions. Returns the updated row, or null if gone. */
export async function updateGuildRole(
  guildId: string,
  roleId: string,
  patch: { name?: string; color?: string | null; permissions?: number },
) {
  const [row] = await db
    .update(guildRole)
    .set(patch)
    .where(and(eq(guildRole.guildId, guildId), eq(guildRole.id, roleId)))
    .returning();
  return row ?? null;
}

/** Hard-delete a role; the FK cascade drops its `memberRole` assignments. */
export async function deleteGuildRole(guildId: string, roleId: string): Promise<boolean> {
  const deleted = await db
    .delete(guildRole)
    .where(and(eq(guildRole.guildId, guildId), eq(guildRole.id, roleId)))
    .returning({ id: guildRole.id });
  return deleted.length > 0;
}

/**
 * The custom role adjacent to `position` in rank order — the swap partner for ▲▼
 * reordering. Positions may have gaps (deletes never renumber), so "adjacent" means
 * nearest, not ±1. Never `@everyone`: position 0 is pinned. Null at the stack's edge.
 */
export async function getAdjacentGuildRole(
  guildId: string,
  position: number,
  direction: "up" | "down",
) {
  const [row] = await db
    .select()
    .from(guildRole)
    .where(
      and(
        eq(guildRole.guildId, guildId),
        eq(guildRole.isDefault, false),
        direction === "up" ? gt(guildRole.position, position) : lt(guildRole.position, position),
      ),
    )
    .orderBy(direction === "up" ? guildRole.position : desc(guildRole.position))
    .limit(1);
  return row ?? null;
}

/** Swap two roles' positions atomically (the adjacent-swap half of `role.reorder`). */
export async function swapGuildRolePositions(
  guildId: string,
  a: { id: string; position: number },
  b: { id: string; position: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(guildRole)
      .set({ position: b.position })
      .where(and(eq(guildRole.guildId, guildId), eq(guildRole.id, a.id)));
    await tx
      .update(guildRole)
      .set({ position: a.position })
      .where(and(eq(guildRole.guildId, guildId), eq(guildRole.id, b.id)));
  });
}

/**
 * Grant a role to a member. Idempotent — re-granting a held role is a no-op; the return
 * value says whether an assignment row was actually created (callers publish only then).
 */
export async function assignMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const inserted = await db
    .insert(memberRole)
    .values({ guildId, userId, roleId })
    .onConflictDoNothing()
    .returning({ roleId: memberRole.roleId });
  return inserted.length > 0;
}

/** Revoke a role from a member. Idempotent; returns whether an assignment row existed. */
export async function unassignMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(memberRole)
    .where(
      and(
        eq(memberRole.guildId, guildId),
        eq(memberRole.userId, userId),
        eq(memberRole.roleId, roleId),
      ),
    )
    .returning({ roleId: memberRole.roleId });
  return deleted.length > 0;
}

/**
 * Insert a role at the BOTTOM of the custom stack: every existing custom role shifts up
 * one and the new role takes position 1 — so it lands strictly below its creator's roles.
 */
export async function createGuildRole(guildId: string, name: string) {
  return db.transaction(async (tx) => {
    await tx
      .update(guildRole)
      .set({ position: sql`${guildRole.position} + 1` })
      .where(and(eq(guildRole.guildId, guildId), eq(guildRole.isDefault, false)));
    const [created] = await tx
      .insert(guildRole)
      .values({ id: crypto.randomUUID(), guildId, name, position: 1 })
      .returning();
    if (!created) throw new Error("Failed to create role.");
    return created;
  });
}
