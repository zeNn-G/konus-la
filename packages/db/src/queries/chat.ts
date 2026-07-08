import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { monotonicFactory } from "ulid";

import { db } from "../index";
import { user } from "../schema/auth";
import { channel, channelParticipant, channelReadState, message } from "../schema/channel";
import { guildMembership } from "../schema/guild";
import { extractMentionCandidates } from "../mention";

/** One factory per process: monotonic within a millisecond, so insert order == id order. */
const nextMessageId = monotonicFactory();

export type ReplyPreviewRow = {
  id: string;
  content: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
} | null;

export type InsertMessageResult =
  | {
      status: "ok";
      message: typeof message.$inferSelect;
      /** Members mentioned by `@username` (author excluded) — the mention-badge targets. */
      mentionedUserIds: string[];
      /** Parent snippet for the reply header — fetched here so the created-event carries it. */
      replyTo: ReplyPreviewRow;
    }
  | { status: "invalid_reply" };

/**
 * Insert a message atomically: validate the reply target lives in the same channel, write
 * the row (ULID id), then resolve `@username` candidates against the channel's audience —
 * guild members when `guildId` is set, DM participants when null — and bump their mention
 * counters. Mentions are counted on insert ONLY (edits never recount).
 */
export async function insertMessage(input: {
  channelId: string;
  guildId: string | null;
  authorId: string;
  content: string;
  replyToMessageId?: string | null;
}): Promise<InsertMessageResult> {
  return db.transaction(async (tx) => {
    let replyToPreview: ReplyPreviewRow = null;
    if (input.replyToMessageId) {
      const [target] = await tx
        .select({
          id: message.id,
          content: message.content,
          authorUsername: user.username,
          authorDisplayName: user.name,
        })
        .from(message)
        .innerJoin(user, eq(message.authorId, user.id))
        .where(
          and(eq(message.id, input.replyToMessageId), eq(message.channelId, input.channelId)),
        )
        .limit(1);
      if (!target) return { status: "invalid_reply" as const };
      replyToPreview = target;
    }

    const [created] = await tx
      .insert(message)
      .values({
        id: nextMessageId(),
        channelId: input.channelId,
        authorId: input.authorId,
        content: input.content,
        replyToMessageId: input.replyToMessageId ?? null,
      })
      .returning();
    if (!created) throw new Error("Failed to insert message.");

    const candidates = extractMentionCandidates(input.content);
    let mentionedUserIds: string[] = [];
    if (candidates.length > 0) {
      const mentioned = input.guildId
        ? await tx
            .select({ userId: user.id })
            .from(user)
            .innerJoin(guildMembership, eq(guildMembership.userId, user.id))
            .where(
              and(eq(guildMembership.guildId, input.guildId), inArray(user.username, candidates)),
            )
        : await tx
            .select({ userId: user.id })
            .from(user)
            .innerJoin(channelParticipant, eq(channelParticipant.userId, user.id))
            .where(
              and(
                eq(channelParticipant.channelId, input.channelId),
                inArray(user.username, candidates),
              ),
            );
      mentionedUserIds = mentioned
        .map((row) => row.userId)
        .filter((id) => id !== input.authorId);

      for (const userId of mentionedUserIds) {
        await tx
          .insert(channelReadState)
          .values({ userId, channelId: input.channelId, mentionsCount: 1 })
          .onConflictDoUpdate({
            target: [channelReadState.userId, channelReadState.channelId],
            set: { mentionsCount: sql`${channelReadState.mentionsCount} + 1` },
          });
      }
    }

    return { status: "ok" as const, message: created, mentionedUserIds, replyTo: replyToPreview };
  });
}

/** Message + its channel's guild, for author/owner permission checks at the API edge. */
export async function getMessageMeta(messageId: string) {
  const [row] = await db
    .select({
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      guildId: channel.guildId,
    })
    .from(message)
    .innerJoin(channel, eq(message.channelId, channel.id))
    .where(eq(message.id, messageId))
    .limit(1);
  return row;
}

/** Author-agnostic content update (authorship is checked at the API edge). Sets `editedAt`. */
export async function updateMessage(messageId: string, content: string) {
  const [updated] = await db
    .update(message)
    .set({ content, editedAt: new Date() })
    .where(eq(message.id, messageId))
    .returning();
  return updated;
}

/** Hard delete. Replies pointing here go replyToMessageId=NULL via the FK. */
export async function deleteMessageRow(messageId: string): Promise<boolean> {
  const deleted = await db
    .delete(message)
    .where(eq(message.id, messageId))
    .returning({ id: message.id });
  return deleted.length > 0;
}

const replyTo = alias(message, "reply_to");
const replyAuthor = alias(user, "reply_author");

/**
 * One history page, newest first: `WHERE id < before` cursor on the `(channelId, id)` index.
 * Fetches limit+1 rows to derive `nextCursor` without a count query. Reply previews come
 * from a self-join — SET NULL parents simply yield `replyTo: null`.
 */
export async function getHistoryPage(input: {
  channelId: string;
  before?: string | null;
  limit: number;
}) {
  const rows = await db
    .select({
      id: message.id,
      channelId: message.channelId,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      replyToMessageId: message.replyToMessageId,
      author: {
        id: user.id,
        username: user.username,
        displayName: user.name,
        image: user.image,
      },
      replyTo: {
        id: replyTo.id,
        content: replyTo.content,
        authorUsername: replyAuthor.username,
        authorDisplayName: replyAuthor.name,
      },
    })
    .from(message)
    .innerJoin(user, eq(message.authorId, user.id))
    .leftJoin(replyTo, eq(message.replyToMessageId, replyTo.id))
    .leftJoin(replyAuthor, eq(replyTo.authorId, replyAuthor.id))
    .where(
      and(
        eq(message.channelId, input.channelId),
        input.before ? lt(message.id, input.before) : undefined,
      ),
    )
    .orderBy(desc(message.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    messages: page.map((row) => ({ ...row, replyTo: row.replyTo?.id ? row.replyTo : null })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
