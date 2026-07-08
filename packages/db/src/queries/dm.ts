import { and, asc, eq, inArray, max, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { decodeTime } from "ulid";

import { db } from "../index";
import { user } from "../schema/auth";
import { channel, channelParticipant, channelReadState, message } from "../schema/channel";
import { publicUserColumns } from "./users";

/**
 * Canonical identity of a 1:1 conversation: the sorted userId pair. The unique index on
 * `channel.dmPairKey` makes concurrent opens race-proof — one insert wins, the loser
 * re-selects the winner's row.
 */
export function dmPairKeyFor(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export type OpenDmResult =
  | { status: "ok"; channelId: string; created: boolean }
  | { status: "unknown_user" };

/**
 * Idempotently open the 1:1 DM between two users. Creates the channel + both participant
 * rows on first open; subsequent opens (from either side) return the existing channel.
 *
 * Deliberately NOT an interactive transaction: concurrent opens (both users clicking
 * "message" at once) would contend on the file lock (SQLITE_BUSY). The `dmPairKey` unique
 * index is the atomicity — one insert wins, the loser re-selects — and the participant
 * upserts are conflict-ignoring, so both racers (or a crash-interrupted earlier open)
 * converge on the same consistent rows.
 */
export async function openDmWithUser(input: {
  selfUserId: string;
  otherUserId: string;
}): Promise<OpenDmResult> {
  const [other] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.otherUserId))
    .limit(1);
  if (!other) return { status: "unknown_user" as const };

  const pairKey = dmPairKeyFor(input.selfUserId, input.otherUserId);
  const [created] = await db
    .insert(channel)
    .values({ id: crypto.randomUUID(), kind: "dm", isGroup: false, dmPairKey: pairKey })
    .onConflictDoNothing({ target: channel.dmPairKey })
    .returning({ id: channel.id });

  let channelId = created?.id;
  if (!channelId) {
    const [existing] = await db
      .select({ id: channel.id })
      .from(channel)
      .where(eq(channel.dmPairKey, pairKey))
      .limit(1);
    if (!existing) throw new Error("dmPairKey conflict without a matching channel");
    channelId = existing.id;
  }

  await db
    .insert(channelParticipant)
    .values([
      { channelId, userId: input.selfUserId },
      { channelId, userId: input.otherUserId },
    ])
    .onConflictDoNothing();

  return { status: "ok" as const, channelId, created: Boolean(created) };
}

export type CreateDmGroupResult =
  | { status: "ok"; channel: typeof channel.$inferSelect }
  | { status: "unknown_user" };

/**
 * Create a group DM owned by its creator. `memberUserIds` excludes the creator and is
 * already deduped/size-validated at the API edge; this only guards existence.
 */
export async function createDmGroup(input: {
  creatorId: string;
  memberUserIds: string[];
  name: string | null;
}): Promise<CreateDmGroupResult> {
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, input.memberUserIds));
    if (found.length !== input.memberUserIds.length) return { status: "unknown_user" as const };

    const [created] = await tx
      .insert(channel)
      .values({
        id: crypto.randomUUID(),
        kind: "dm",
        isGroup: true,
        name: input.name,
        ownerId: input.creatorId,
      })
      .returning();
    if (!created) throw new Error("Failed to create group DM.");

    await tx.insert(channelParticipant).values(
      [input.creatorId, ...input.memberUserIds].map((userId) => ({
        channelId: created.id,
        userId,
      })),
    );
    return { status: "ok" as const, channel: created };
  });
}

export type AddDmParticipantResult = "ok" | "already_participant" | "full" | "unknown_user";

/** Add a user to a group DM, enforcing the size cap inside the transaction. */
export async function addDmParticipant(input: {
  channelId: string;
  userId: string;
  maxSize: number;
}): Promise<AddDmParticipantResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!target) return "unknown_user" as const;

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(channelParticipant)
      .where(eq(channelParticipant.channelId, input.channelId));
    if ((countRow?.count ?? 0) >= input.maxSize) return "full" as const;

    const inserted = await tx
      .insert(channelParticipant)
      .values({ channelId: input.channelId, userId: input.userId })
      .onConflictDoNothing({ target: [channelParticipant.userId, channelParticipant.channelId] })
      .returning({ userId: channelParticipant.userId });
    return inserted.length > 0 ? ("ok" as const) : ("already_participant" as const);
  });
}

/**
 * Remove a participant from a group DM. Also deletes their read-state row — membership is
 * the only key to history, and a re-added member must not inherit a stale watermark or
 * mention counter. Returns false when they weren't a participant.
 */
export async function removeDmParticipant(channelId: string, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(channelParticipant)
      .where(and(eq(channelParticipant.channelId, channelId), eq(channelParticipant.userId, userId)))
      .returning({ userId: channelParticipant.userId });
    if (deleted.length === 0) return false;
    await tx
      .delete(channelReadState)
      .where(and(eq(channelReadState.channelId, channelId), eq(channelReadState.userId, userId)));
    return true;
  });
}

export type LeaveDmGroupResult =
  | { status: "not_participant" }
  | { status: "deleted" }
  | { status: "left"; newOwnerId: string | null; remainingUserIds: string[] };

/**
 * Leave a group DM. The last leaver hard-deletes the channel (cascade wipes messages and
 * read states). When the owner leaves — or the owner slot is somehow NULL — ownership
 * transfers to the longest-standing remaining participant (earliest joinedAt, then lowest
 * userId). Returns the remaining userIds so the caller can fan out without re-querying.
 */
export async function leaveDmGroup(input: {
  channelId: string;
  userId: string;
}): Promise<LeaveDmGroupResult> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(channelParticipant)
      .where(
        and(
          eq(channelParticipant.channelId, input.channelId),
          eq(channelParticipant.userId, input.userId),
        ),
      )
      .returning({ userId: channelParticipant.userId });
    if (deleted.length === 0) return { status: "not_participant" as const };

    await tx
      .delete(channelReadState)
      .where(
        and(
          eq(channelReadState.channelId, input.channelId),
          eq(channelReadState.userId, input.userId),
        ),
      );

    const remaining = await tx
      .select({ userId: channelParticipant.userId })
      .from(channelParticipant)
      .where(eq(channelParticipant.channelId, input.channelId))
      .orderBy(asc(channelParticipant.joinedAt), asc(channelParticipant.userId));

    if (remaining.length === 0) {
      await tx.delete(channel).where(eq(channel.id, input.channelId));
      return { status: "deleted" as const };
    }

    const [row] = await tx
      .select({ ownerId: channel.ownerId })
      .from(channel)
      .where(eq(channel.id, input.channelId))
      .limit(1);
    let newOwnerId = row?.ownerId ?? null;
    if (newOwnerId === null || newOwnerId === input.userId) {
      newOwnerId = (remaining[0] as { userId: string }).userId;
      await tx.update(channel).set({ ownerId: newOwnerId }).where(eq(channel.id, input.channelId));
    }

    return {
      status: "left" as const,
      newOwnerId,
      remainingUserIds: remaining.map((r) => r.userId),
    };
  });
}

/** All participant userIds of a DM channel — the recipient set for that channel's events. */
export async function listChannelParticipantUserIds(channelId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: channelParticipant.userId })
    .from(channelParticipant)
    .where(eq(channelParticipant.channelId, channelId));
  return rows.map((row) => row.userId);
}

/** Membership check for the DM branch of `requireChannelMember`. */
export async function isChannelParticipant(channelId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: channelParticipant.userId })
    .from(channelParticipant)
    .where(and(eq(channelParticipant.channelId, channelId), eq(channelParticipant.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Participant roster with profile fields, longest-standing first (owner-transfer order). */
export async function getDmParticipants(channelId: string) {
  return db
    .select({
      userId: user.id,
      ...publicUserColumns,
      joinedAt: channelParticipant.joinedAt,
    })
    .from(channelParticipant)
    .innerJoin(user, eq(channelParticipant.userId, user.id))
    .where(eq(channelParticipant.channelId, channelId))
    .orderBy(asc(channelParticipant.joinedAt), asc(channelParticipant.userId));
}

/** Distinct users sharing at least one DM channel with `userId` — presence scope UNION arm. */
export async function listDmCoParticipantUserIds(userId: string): Promise<string[]> {
  const own = alias(channelParticipant, "own");
  const rows = await db
    .selectDistinct({ userId: channelParticipant.userId })
    .from(own)
    .innerJoin(channelParticipant, eq(channelParticipant.channelId, own.channelId))
    .where(and(eq(own.userId, userId), ne(channelParticipant.userId, userId)));
  return rows.map((row) => row.userId);
}

/** Rename a group DM (null clears back to the participant-names fallback). */
export async function renameDmChannel(channelId: string, name: string | null) {
  const [updated] = await db
    .update(channel)
    .set({ name })
    .where(eq(channel.id, channelId))
    .returning();
  return updated;
}

/**
 * The viewer's DM list. Empty 1:1s are dropped (draft-created channels stay invisible until
 * their first message); groups always list. `lastActivityAt` is the newest message's ULID
 * timestamp, falling back to channel creation — rows sort newest-activity first.
 */
export async function listDmChannelsForViewer(userId: string) {
  const newest = db
    .select({
      channelId: message.channelId,
      newestMessageId: max(message.id).as("newest_message_id"),
    })
    .from(message)
    .groupBy(message.channelId)
    .as("newest");

  const own = alias(channelParticipant, "own");
  const rows = await db
    .select({
      id: channel.id,
      isGroup: channel.isGroup,
      name: channel.name,
      ownerId: channel.ownerId,
      createdAt: channel.createdAt,
      newestMessageId: newest.newestMessageId,
      lastReadMessageId: channelReadState.lastReadMessageId,
      mentionsCount: channelReadState.mentionsCount,
    })
    .from(own)
    .innerJoin(channel, eq(channel.id, own.channelId))
    .leftJoin(newest, eq(newest.channelId, channel.id))
    .leftJoin(
      channelReadState,
      and(eq(channelReadState.channelId, channel.id), eq(channelReadState.userId, userId)),
    )
    .where(and(eq(own.userId, userId), eq(channel.kind, "dm")));

  const visible = rows.filter((row) => row.isGroup || row.newestMessageId !== null);
  const channelIds = visible.map((row) => row.id);
  const participants =
    channelIds.length === 0
      ? []
      : await db
          .select({
            channelId: channelParticipant.channelId,
            userId: user.id,
            ...publicUserColumns,
          })
          .from(channelParticipant)
          .innerJoin(user, eq(channelParticipant.userId, user.id))
          .where(inArray(channelParticipant.channelId, channelIds))
          .orderBy(asc(channelParticipant.joinedAt), asc(channelParticipant.userId));

  const byChannel = new Map<string, Omit<(typeof participants)[number], "channelId">[]>();
  for (const { channelId, ...participant } of participants) {
    const list = byChannel.get(channelId) ?? [];
    list.push(participant);
    byChannel.set(channelId, list);
  }

  return visible
    .map((row) => ({
      id: row.id,
      isGroup: row.isGroup,
      name: row.name,
      ownerId: row.ownerId,
      participants: byChannel.get(row.id) ?? [],
      newestMessageId: row.newestMessageId,
      unread:
        row.newestMessageId !== null &&
        (row.lastReadMessageId === null || row.lastReadMessageId < row.newestMessageId),
      mentionsCount: row.mentionsCount ?? 0,
      lastActivityAt: row.newestMessageId
        ? decodeTime(row.newestMessageId)
        : row.createdAt.getTime(),
    }))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
