import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { monotonicFactory } from "ulid";

import { db } from "../index";
import { user } from "../schema/auth";
import { report } from "../schema/moderation";

/** One factory per process: monotonic within a millisecond, so insert order == id order. */
const nextReportId = monotonicFactory();

/**
 * File a report, snapshotting the message's author and content AT REPORT TIME — the
 * snapshot (not the `messageId` FK, which goes null on hard delete) is the record the
 * inbox shows, so a report survives the deletion of what it reports.
 */
export async function createReport(input: {
  guildId: string;
  channelId: string;
  messageId: string;
  messageAuthorId: string;
  messageContent: string;
  reason: string;
  reporterId: string;
}): Promise<string> {
  const id = nextReportId();
  await db.insert(report).values({ id, ...input });
  return id;
}

/** Unresolved reports in a guild — the inbox badge's number. */
export async function countUnresolvedReports(guildId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(report)
    .where(and(eq(report.guildId, guildId), isNull(report.resolvedAt)));
  return row?.count ?? 0;
}

/**
 * Mark a report resolved — never touches the message; resolution is a mark, not an action.
 * Scoped to `guildId` so a foreign report id can't ride a caller's own-guild gate. The
 * unresolved-only WHERE makes racing moderators safe: the first write wins, the second
 * reports `already` so callers skip the audit entry and fan-out instead of double-marking.
 */
export async function resolveReport(input: {
  guildId: string;
  reportId: string;
  resolvedById: string;
}): Promise<"resolved" | "already" | "missing"> {
  const updated = await db
    .update(report)
    .set({ resolvedAt: new Date(), resolvedById: input.resolvedById })
    .where(
      and(
        eq(report.id, input.reportId),
        eq(report.guildId, input.guildId),
        isNull(report.resolvedAt),
      ),
    )
    .returning({ id: report.id });
  if (updated.length > 0) return "resolved";

  const [existing] = await db
    .select({ id: report.id })
    .from(report)
    .where(and(eq(report.id, input.reportId), eq(report.guildId, input.guildId)))
    .limit(1);
  return existing ? "already" : "missing";
}

const messageAuthor = alias(user, "message_author");
const reporter = alias(user, "reporter");
const resolvedBy = alias(user, "resolved_by");

/**
 * A guild's reports, newest first (ULID PK order). `resolved` filters by resolution state;
 * omitted = all. Author/reporter rows cascade with their user, but `resolvedById` carries
 * no FK — a departed resolver LEFT-joins to null display info, never a missing row.
 */
export async function listReports(input: { guildId: string; resolved?: boolean }) {
  const rows = await db
    .select({
      id: report.id,
      channelId: report.channelId,
      messageId: report.messageId,
      messageContent: report.messageContent,
      reason: report.reason,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
      messageAuthor: {
        id: report.messageAuthorId,
        username: messageAuthor.username,
        displayName: messageAuthor.name,
        image: messageAuthor.image,
      },
      reporter: {
        id: report.reporterId,
        username: reporter.username,
        displayName: reporter.name,
      },
      resolvedBy: {
        id: report.resolvedById,
        username: resolvedBy.username,
        displayName: resolvedBy.name,
      },
    })
    .from(report)
    .leftJoin(messageAuthor, eq(report.messageAuthorId, messageAuthor.id))
    .leftJoin(reporter, eq(report.reporterId, reporter.id))
    .leftJoin(resolvedBy, eq(report.resolvedById, resolvedBy.id))
    .where(
      and(
        eq(report.guildId, input.guildId),
        input.resolved === undefined
          ? undefined
          : input.resolved
            ? isNotNull(report.resolvedAt)
            : isNull(report.resolvedAt),
      ),
    )
    .orderBy(desc(report.id));

  return rows.map((row) => ({
    ...row,
    resolvedBy: row.resolvedBy?.id ? row.resolvedBy : null,
  }));
}
