import { and, desc, eq, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { monotonicFactory } from "ulid";

import { db } from "../index";
import { user } from "../schema/auth";
import { auditLogEntry } from "../schema/moderation";

/** One factory per process: monotonic within a millisecond, so insert order == id order. */
const nextAuditEntryId = monotonicFactory();

/**
 * The frozen action vocabulary (Phase 6 spec, charter 7). Every privileged mutation records
 * exactly one of these AFTER it succeeds; the spec's table fixes each action's target
 * columns and `metadata` shape (changed fields as `[old, new]` pairs). Self-service actions
 * (own edits/deletes, self mute/deaf, markRead), joins/leaves, invite consumption, and
 * instance-ban are deliberately absent.
 */
export type AuditAction =
  | "member.kick"
  | "member.ban"
  | "member.unban"
  | "member.serverMute"
  | "member.voiceDisconnect"
  | "message.modDelete"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "role.reorder"
  | "role.assign"
  | "role.unassign"
  | "channel.create"
  | "channel.update"
  | "channel.delete"
  | "guild.update"
  | "guild.transferOwnership"
  | "invite.create"
  | "invite.revoke"
  | "report.resolve";

/**
 * Append one forensic record to a guild's audit log. Callers invoke this after the
 * mutation succeeds — never before, so a failed action leaves no trace. The row carries
 * plain ids on purpose (no FKs): it must survive whatever it references being deleted.
 */
export async function recordAuditEntry(input: {
  guildId: string;
  actorId: string;
  action: AuditAction;
  targetUserId?: string | null;
  targetChannelId?: string | null;
  targetMessageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogEntry).values({
    id: nextAuditEntryId(),
    guildId: input.guildId,
    actorId: input.actorId,
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    targetChannelId: input.targetChannelId ?? null,
    targetMessageId: input.targetMessageId ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
  });
}

const actor = alias(user, "actor");
const targetUser = alias(user, "target_user");

/**
 * One audit page, newest first: `WHERE id < before` cursor on the ULID PK (the
 * `chat.history` pattern), limit+1 to derive `nextCursor` without a count. Actor and
 * target-user display info come from LEFT joins — deleted accounts yield null names, never
 * a missing entry.
 */
export async function listAuditEntries(input: {
  guildId: string;
  before?: string | null;
  limit: number;
}) {
  const rows = await db
    .select({
      id: auditLogEntry.id,
      action: auditLogEntry.action,
      targetUserId: auditLogEntry.targetUserId,
      targetChannelId: auditLogEntry.targetChannelId,
      targetMessageId: auditLogEntry.targetMessageId,
      metadata: auditLogEntry.metadata,
      createdAt: auditLogEntry.createdAt,
      actor: {
        id: auditLogEntry.actorId,
        username: actor.username,
        displayName: actor.name,
        image: actor.image,
      },
      targetUser: {
        id: targetUser.id,
        username: targetUser.username,
        displayName: targetUser.name,
      },
    })
    .from(auditLogEntry)
    .leftJoin(actor, eq(auditLogEntry.actorId, actor.id))
    .leftJoin(targetUser, eq(auditLogEntry.targetUserId, targetUser.id))
    .where(
      and(
        eq(auditLogEntry.guildId, input.guildId),
        input.before ? lt(auditLogEntry.id, input.before) : undefined,
      ),
    )
    .orderBy(desc(auditLogEntry.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    entries: page.map((row) => ({
      ...row,
      action: row.action as AuditAction,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      targetUser: row.targetUser?.id ? row.targetUser : null,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
