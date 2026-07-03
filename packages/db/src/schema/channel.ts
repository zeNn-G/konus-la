import { relations, sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { guild } from "./guild";

/**
 * Channel — a place messages live. Either belongs to a Guild (`guildId` set, `name` set)
 * or is a DM (`guildId` null — Phase 4; participants live in a future ChannelParticipant
 * table). `kind` carries the full enum from day one so voice (Phase 5) and DMs are purely
 * additive; only `text` is creatable in Phase 3. Names are lowercase slugs, unique per
 * guild (SQLite treats NULL guildIds as distinct, so DMs never collide).
 */
export const channel = sqliteTable(
  "channel",
  {
    // TODO: can move to a DB-generated uuid later
    id: text("id").primaryKey(),
    guildId: text("guild_id").references(() => guild.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["text", "voice", "dm"] }).notNull(),
    name: text("name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("channel_guild_id_name_uq").on(table.guildId, table.name),
    index("channel_guild_id_idx").on(table.guildId),
  ],
);

/**
 * Message — a text post in a channel. ULID text PK: lexicographic order IS chronological
 * order, so cursor pagination and "newest message" reduce to plain string comparison on
 * the `(channelId, id)` index. `replyToMessageId` goes NULL when the parent is hard-deleted
 * (deleted means gone — the reply becomes an ordinary message). Edits set `editedAt` only;
 * old content is not retained.
 */
export const message = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    replyToMessageId: text("reply_to_message_id"),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("message_channel_id_id_idx").on(table.channelId, table.id),
    foreignKey({
      columns: [table.replyToMessageId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
  ],
);

/**
 * ChannelReadState — per-user per-channel read marker + mention counter. `lastReadMessageId`
 * is a watermark, NOT a foreign key: it stays valid (ULID-comparable) even after the message
 * it names is deleted. Rows are created lazily (first markRead or first incoming mention);
 * a missing row means "everything unread". `mentionsCount` is fire-on-send lossy by design —
 * edits/deletes never recount; opening the channel zeroes it.
 */
export const channelReadState = sqliteTable(
  "channel_read_state",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    lastReadMessageId: text("last_read_message_id"),
    mentionsCount: integer("mentions_count").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channelId] })],
);

export const channelRelations = relations(channel, ({ one, many }) => ({
  guild: one(guild, {
    fields: [channel.guildId],
    references: [guild.id],
  }),
  messages: many(message),
}));

export const messageRelations = relations(message, ({ one }) => ({
  channel: one(channel, {
    fields: [message.channelId],
    references: [channel.id],
  }),
  author: one(user, {
    fields: [message.authorId],
    references: [user.id],
    relationName: "messageAuthor",
  }),
  replyTo: one(message, {
    fields: [message.replyToMessageId],
    references: [message.id],
    relationName: "messageReplyTo",
  }),
}));

export const channelReadStateRelations = relations(channelReadState, ({ one }) => ({
  channel: one(channel, {
    fields: [channelReadState.channelId],
    references: [channel.id],
  }),
  user: one(user, {
    fields: [channelReadState.userId],
    references: [user.id],
    relationName: "readStateUser",
  }),
}));
