import { and, eq, isNull, lt, max, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "../index";
import { channel, channelReadState, message } from "../schema/channel";
import { guildMembership } from "../schema/guild";
import { isChannelParticipant, listDmCoParticipantUserIds } from "./dm";
import { isGuildMember } from "./guild";

// ---------------------------------------------------------------------------
// Channel lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a guild channel. `kind` is required here — the API boundary is where the `text`
 * default lives. Throws on a (guildId, kind, name) unique violation — router maps to CONFLICT.
 */
export async function createChannel(input: {
  guildId: string;
  name: string;
  kind: "text" | "voice";
}) {
  const [created] = await db
    .insert(channel)
    .values({ id: crypto.randomUUID(), guildId: input.guildId, kind: input.kind, name: input.name })
    .returning();
  if (!created) throw new Error("Failed to create channel.");
  return created;
}

/**
 * Rename a channel, scoped to its guild. Returns the updated row plus the pre-rename name
 * (the audit entry's `[old, new]` pair), or undefined if not found.
 */
export async function renameChannel(input: { channelId: string; guildId: string; name: string }) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ name: channel.name })
      .from(channel)
      .where(and(eq(channel.id, input.channelId), eq(channel.guildId, input.guildId)))
      .limit(1);
    if (!existing) return undefined;
    const [updated] = await tx
      .update(channel)
      .set({ name: input.name })
      .where(and(eq(channel.id, input.channelId), eq(channel.guildId, input.guildId)))
      .returning();
    if (!updated) return undefined;
    return { ...updated, previousName: existing.name };
  });
}

/**
 * Hard-delete a channel; FK cascades drop its messages and read states. Returns the deleted
 * row (the event payload needs it), or undefined when nothing matched.
 */
export async function deleteChannel(channelId: string, guildId: string) {
  const [deleted] = await db
    .delete(channel)
    .where(and(eq(channel.id, channelId), eq(channel.guildId, guildId)))
    .returning();
  return deleted;
}

/**
 * Whether `userId` may act inside a channel: guild membership for guild channels, a
 * `channelParticipant` row for DMs (`guildId` null).
 */
export async function userBelongsToChannel(
  channelId: string,
  guildId: string | null,
  userId: string,
): Promise<boolean> {
  return guildId ? isGuildMember(guildId, userId) : isChannelParticipant(channelId, userId);
}

/** Channel lookup for membership gating; carries the DM fields so handlers don't re-query. */
export async function getChannel(channelId: string) {
  const [row] = await db
    .select({
      id: channel.id,
      guildId: channel.guildId,
      kind: channel.kind,
      name: channel.name,
      isGroup: channel.isGroup,
      ownerId: channel.ownerId,
    })
    .from(channel)
    .where(eq(channel.id, channelId))
    .limit(1);
  return row;
}

/**
 * Channels of a guild with the viewer's unread state, ordered by creation. Unread reduces
 * to a ULID string comparison: newest message id vs the viewer's read watermark. The
 * grouped-max subquery rides the `(channelId, id)` index; SQLite string-MAX is valid
 * because ULIDs are fixed-width and lexicographically chronological.
 */
export async function listChannelsForViewer(guildId: string, userId: string) {
  const newest = db
    .select({
      channelId: message.channelId,
      newestMessageId: max(message.id).as("newest_message_id"),
    })
    .from(message)
    .groupBy(message.channelId)
    .as("newest");

  const rows = await db
    .select({
      id: channel.id,
      name: channel.name,
      kind: channel.kind,
      createdAt: channel.createdAt,
      newestMessageId: newest.newestMessageId,
      lastReadMessageId: channelReadState.lastReadMessageId,
      mentionsCount: channelReadState.mentionsCount,
    })
    .from(channel)
    .leftJoin(newest, eq(newest.channelId, channel.id))
    .leftJoin(
      channelReadState,
      and(eq(channelReadState.channelId, channel.id), eq(channelReadState.userId, userId)),
    )
    .where(eq(channel.guildId, guildId))
    .orderBy(channel.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.createdAt,
    newestMessageId: row.newestMessageId,
    unread:
      row.newestMessageId !== null &&
      (row.lastReadMessageId === null || row.lastReadMessageId < row.newestMessageId),
    mentionsCount: row.mentionsCount ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Recipient sets (event fan-out)
// ---------------------------------------------------------------------------

/** All member userIds of a guild — the recipient set for that guild's events. */
export async function listGuildMemberUserIds(guildId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: guildMembership.userId })
    .from(guildMembership)
    .where(eq(guildMembership.guildId, guildId));
  return rows.map((row) => row.userId);
}

/**
 * Distinct users sharing at least one guild OR one DM channel with `userId` (excluding the
 * subject) — the presence broadcast scope.
 */
export async function listCoMemberUserIds(userId: string): Promise<string[]> {
  const own = alias(guildMembership, "own");
  const rows = await db
    .selectDistinct({ userId: guildMembership.userId })
    .from(own)
    .innerJoin(guildMembership, eq(guildMembership.guildId, own.guildId))
    .where(and(eq(own.userId, userId), ne(guildMembership.userId, userId)));
  const viaDm = await listDmCoParticipantUserIds(userId);
  return [...new Set([...rows.map((row) => row.userId), ...viaDm])];
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

/**
 * Advance the viewer's read watermark — forward-only (`setWhere` guard), so a stale tab can
 * never rewind a fresher device. Zeroes the mention counter. Returns the applied row, or
 * undefined when the guard rejected (caller skips the readState.updated event).
 */
export async function markChannelRead(input: {
  userId: string;
  channelId: string;
  messageId: string;
}) {
  const [applied] = await db
    .insert(channelReadState)
    .values({
      userId: input.userId,
      channelId: input.channelId,
      lastReadMessageId: input.messageId,
      mentionsCount: 0,
    })
    .onConflictDoUpdate({
      target: [channelReadState.userId, channelReadState.channelId],
      set: { lastReadMessageId: input.messageId, mentionsCount: 0 },
      setWhere: or(
        isNull(channelReadState.lastReadMessageId),
        lt(channelReadState.lastReadMessageId, input.messageId),
      ),
    })
    .returning({
      lastReadMessageId: channelReadState.lastReadMessageId,
      mentionsCount: channelReadState.mentionsCount,
    });
  return applied;
}
