import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../index";
import { user } from "../schema/auth";
import { channel } from "../schema/channel";
import {
  guild,
  guildBan,
  guildInvite,
  guildMembership,
  guildRole,
  memberRole,
} from "../schema/guild";
import { randomCode } from "../constants";

// ---------------------------------------------------------------------------
// Guild lifecycle
// ---------------------------------------------------------------------------

/** Number of guilds this user OWNS (drives the MAX_GUILDS_PER_USER cap; joined guilds don't count). */
export async function countOwnedGuilds(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(guild)
    .where(eq(guild.ownerId, userId));
  return row?.count ?? 0;
}

/**
 * Create a guild and bootstrap it atomically: insert the guild, seed the single implicit
 * `@everyone` role (`isDefault: true`), and insert the owner's membership row. Returns the guild.
 */
export async function createGuildWithOwner(input: { name: string; ownerUserId: string }) {
  return db.transaction(async (tx) => {
    const guildId = crypto.randomUUID();
    const [createdGuild] = await tx
      .insert(guild)
      .values({ id: guildId, name: input.name, ownerId: input.ownerUserId })
      .returning();
    if (!createdGuild) throw new Error("Failed to create guild.");

    await tx.insert(guildRole).values({
      id: crypto.randomUUID(),
      guildId,
      name: "everyone",
      isDefault: true,
      position: 0,
    });

    await tx.insert(guildMembership).values({ userId: input.ownerUserId, guildId });

    // Every guild starts with a #general so a fresh guild is never an empty screen.
    await tx.insert(channel).values({
      id: crypto.randomUUID(),
      guildId,
      kind: "text",
      name: "general",
    });

    return createdGuild;
  });
}

/** Guilds the user belongs to (owned or joined), oldest first. */
export async function listUserGuilds(userId: string) {
  return db
    .select({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      ownerId: guild.ownerId,
    })
    .from(guildMembership)
    .innerJoin(guild, eq(guildMembership.guildId, guild.id))
    .where(eq(guildMembership.userId, userId))
    .orderBy(guild.createdAt);
}

/**
 * Fetch a guild for a viewer who must be a member. Returns `{ guild, isOwner }`, or `null`
 * when the viewer isn't a member (drives the no-peek FORBIDDEN at the API edge).
 */
export async function getGuildForViewer(guildId: string, userId: string) {
  const [row] = await db
    .select({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      ownerId: guild.ownerId,
      createdAt: guild.createdAt,
    })
    .from(guildMembership)
    .innerJoin(guild, eq(guildMembership.guildId, guild.id))
    .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { guild: row, isOwner: row.ownerId === userId };
}

/**
 * Member roster for a guild (any member may see it), oldest membership first. Each row
 * carries the member's assigned `roleIds` (empty = `@everyone` only) and the persistent
 * `serverMuted` flag, so the client can group, tint, and badge without extra fetches.
 */
export async function listGuildMembers(guildId: string) {
  const members = await db
    .select({
      userId: guildMembership.userId,
      username: user.username,
      displayName: user.name,
      image: user.image,
      joinedAt: guildMembership.joinedAt,
      serverMuted: guildMembership.serverMuted,
    })
    .from(guildMembership)
    .innerJoin(user, eq(guildMembership.userId, user.id))
    .where(eq(guildMembership.guildId, guildId))
    .orderBy(guildMembership.joinedAt);

  const assignments = await db
    .select({ userId: memberRole.userId, roleId: memberRole.roleId })
    .from(memberRole)
    .where(eq(memberRole.guildId, guildId));
  const roleIdsByUser = new Map<string, string[]>();
  for (const { userId, roleId } of assignments) {
    const list = roleIdsByUser.get(userId);
    if (list) list.push(roleId);
    else roleIdsByUser.set(userId, [roleId]);
  }

  return members.map((member) => ({
    ...member,
    roleIds: roleIdsByUser.get(member.userId) ?? [],
  }));
}

/** All roles of a guild, highest position (rank) first; `@everyone` (position 0) last. */
export async function listGuildRoles(guildId: string) {
  return db
    .select({
      id: guildRole.id,
      name: guildRole.name,
      color: guildRole.color,
      position: guildRole.position,
      permissions: guildRole.permissions,
      isDefault: guildRole.isDefault,
    })
    .from(guildRole)
    .where(eq(guildRole.guildId, guildId))
    .orderBy(desc(guildRole.position), guildRole.createdAt);
}

export async function isGuildMember(guildId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: guildMembership.userId })
    .from(guildMembership)
    .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function isGuildOwner(guildId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: guild.id })
    .from(guild)
    .where(and(eq(guild.id, guildId), eq(guild.ownerId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Transfer ownership: the new owner must already be a member. Single-column `ownerId`
 * update — the old owner stays an ordinary member. Returns false when the target isn't a member.
 */
export async function transferOwnership(guildId: string, newOwnerUserId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ userId: guildMembership.userId })
      .from(guildMembership)
      .where(
        and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, newOwnerUserId)),
      )
      .limit(1);
    if (!member) return false;
    await tx.update(guild).set({ ownerId: newOwnerUserId }).where(eq(guild.id, guildId));
    return true;
  });
}

/** Hard-delete a guild; FK cascades drop roles, memberships, invites, bans, and member roles. */
export async function deleteGuild(guildId: string): Promise<void> {
  await db.delete(guild).where(eq(guild.id, guildId));
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** Mint a shareable invite. `expiresAt` null = never expires. */
export async function createInvite(input: {
  guildId: string;
  createdByUserId: string;
  expiresAt?: Date | null;
}) {
  const [created] = await db
    .insert(guildInvite)
    .values({
      id: crypto.randomUUID(),
      code: randomCode(),
      guildId: input.guildId,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!created) throw new Error("Failed to create invite.");
  return created;
}

/** An invite that can still be used: exists and not expired. Returns the row or undefined. */
export async function findUsableInvite(code: string, now = new Date()) {
  const [invite] = await db
    .select()
    .from(guildInvite)
    .where(eq(guildInvite.code, code))
    .limit(1);
  if (!invite) return undefined;
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return undefined;
  return invite;
}

export type ConsumeInviteResult =
  | { status: "ok"; guildId: string }
  | { status: "already_member"; guildId: string }
  | { status: "banned" }
  | { status: "invalid" };

/**
 * Redeem an invite code in one transaction: validate (exists + not expired) → ban beats
 * invite (rejected) → already a member (idempotent no-op) → otherwise insert the membership
 * and tick `usedCount`.
 */
export async function consumeInvite(
  code: string,
  userId: string,
  now = new Date(),
): Promise<ConsumeInviteResult> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(guildInvite)
      .where(eq(guildInvite.code, code))
      .limit(1);
    if (!invite) return { status: "invalid" };
    if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) {
      return { status: "invalid" };
    }
    const { guildId } = invite;

    const [ban] = await tx
      .select({ userId: guildBan.userId })
      .from(guildBan)
      .where(and(eq(guildBan.guildId, guildId), eq(guildBan.userId, userId)))
      .limit(1);
    if (ban) return { status: "banned" };

    const [existing] = await tx
      .select({ userId: guildMembership.userId })
      .from(guildMembership)
      .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)))
      .limit(1);
    if (existing) return { status: "already_member", guildId };

    await tx.insert(guildMembership).values({ userId, guildId });
    await tx
      .update(guildInvite)
      .set({ usedCount: sql`${guildInvite.usedCount} + 1` })
      .where(eq(guildInvite.id, invite.id));
    return { status: "ok", guildId };
  });
}

/** All invites for a guild, newest first. `usedCount` is display-only. */
export async function listInvites(guildId: string) {
  return db
    .select({
      id: guildInvite.id,
      code: guildInvite.code,
      expiresAt: guildInvite.expiresAt,
      usedCount: guildInvite.usedCount,
      createdAt: guildInvite.createdAt,
    })
    .from(guildInvite)
    .where(eq(guildInvite.guildId, guildId))
    .orderBy(desc(guildInvite.createdAt));
}

/** Revoke (hard-delete) an invite. Scoped to its guild. Returns true when a row was deleted. */
export async function deleteInvite(id: string, guildId: string): Promise<boolean> {
  const deleted = await db
    .delete(guildInvite)
    .where(and(eq(guildInvite.id, id), eq(guildInvite.guildId, guildId)))
    .returning({ id: guildInvite.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/** Remove a member (kick). They may rejoin. Returns true when a membership was removed. */
export async function kickMember(guildId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(guildMembership)
    .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)))
    .returning({ userId: guildMembership.userId });
  return deleted.length > 0;
}

/** Ban a user: drop their membership and record the ban (idempotent) in one transaction. */
export async function banMember(input: {
  guildId: string;
  userId: string;
  reason?: string | null;
  bannedByUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(guildMembership)
      .where(
        and(eq(guildMembership.guildId, input.guildId), eq(guildMembership.userId, input.userId)),
      );
    await tx
      .insert(guildBan)
      .values({
        guildId: input.guildId,
        userId: input.userId,
        reason: input.reason ?? null,
        bannedByUserId: input.bannedByUserId,
      })
      .onConflictDoUpdate({
        target: [guildBan.guildId, guildBan.userId],
        set: { reason: input.reason ?? null, bannedByUserId: input.bannedByUserId },
      });
  });
}

/** Lift a ban. Returns true when a ban row was removed. */
export async function unbanMember(guildId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(guildBan)
    .where(and(eq(guildBan.guildId, guildId), eq(guildBan.userId, userId)))
    .returning({ userId: guildBan.userId });
  return deleted.length > 0;
}

/** Banned users for a guild, newest first. */
export async function listBans(guildId: string) {
  return db
    .select({
      userId: guildBan.userId,
      username: user.username,
      displayName: user.name,
      reason: guildBan.reason,
      createdAt: guildBan.createdAt,
    })
    .from(guildBan)
    .innerJoin(user, eq(guildBan.userId, user.id))
    .where(eq(guildBan.guildId, guildId))
    .orderBy(desc(guildBan.createdAt));
}

/** Self-removal from a guild (the router forbids the owner from leaving). */
export async function leaveGuild(guildId: string, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(guildMembership)
    .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)))
    .returning({ userId: guildMembership.userId });
  return deleted.length > 0;
}

export async function isBanned(guildId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: guildBan.userId })
    .from(guildBan)
    .where(and(eq(guildBan.guildId, guildId), eq(guildBan.userId, userId)))
    .limit(1);
  return Boolean(row);
}
