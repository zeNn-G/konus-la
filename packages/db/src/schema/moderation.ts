import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { channel, message } from "./channel";
import { guild } from "./guild";

/**
 * Report — a member's report of a message, scoped to one guild (DMs are never reportable).
 * ULID text PK: newest-first listing and pagination reduce to string comparison.
 * `messageContent` is a SNAPSHOT taken at report time and `messageId` goes NULL when the
 * message is hard-deleted — the report is the record that survives deletion. Resolution is
 * a mark (`resolvedAt` + `resolvedById`), never a forced action; `resolvedById` carries no
 * FK so the record outlives the resolver's account.
 */
export const report = sqliteTable(
  "report",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => message.id, { onDelete: "set null" }),
    messageAuthorId: text("message_author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    messageContent: text("message_content").notNull(),
    reason: text("reason").notNull(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedById: text("resolved_by_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("report_guild_id_idx").on(table.guildId)],
);

/**
 * AuditLogEntry — a forensic record of one privileged mutation in a guild. ULID text PK
 * doubles as the pagination cursor. `actorId` and the three target columns carry NO
 * foreign keys, DELIBERATELY: audit entries must survive the deletion of what they
 * reference (a mod-deleted message, a deleted channel, a departed user). Only `guildId`
 * cascades — guild gone means log gone. `metadata` is a JSON string (changed fields as
 * `[old, new]` pairs; shapes per the Phase 6 spec's action table).
 */
export const auditLogEntry = sqliteTable(
  "audit_log_entry",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetUserId: text("target_user_id"),
    targetChannelId: text("target_channel_id"),
    targetMessageId: text("target_message_id"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("audit_log_entry_guild_id_idx").on(table.guildId)],
);

export const reportRelations = relations(report, ({ one }) => ({
  guild: one(guild, {
    fields: [report.guildId],
    references: [guild.id],
  }),
  reporter: one(user, {
    fields: [report.reporterId],
    references: [user.id],
    relationName: "reportReporter",
  }),
  messageAuthor: one(user, {
    fields: [report.messageAuthorId],
    references: [user.id],
    relationName: "reportMessageAuthor",
  }),
}));

export const auditLogEntryRelations = relations(auditLogEntry, ({ one }) => ({
  guild: one(guild, {
    fields: [auditLogEntry.guildId],
    references: [guild.id],
  }),
}));
