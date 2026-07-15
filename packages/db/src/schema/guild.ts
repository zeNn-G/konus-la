import { relations, sql } from "drizzle-orm";
import { foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * Guild — a self-contained server users belong to, owning members and (later) channels.
 *
 * Ownership is `ownerId` only — never a role row (see ADR 0004). This gives a single
 * source of truth for ownership and a schema-level "exactly one owner" guarantee; the
 * owner's elevated power is an `if (userId === guild.ownerId)` short-circuit. `name` is
 * deliberately non-unique. `icon` is nullable: when null the client renders a Dicebear
 * `identicon` seeded by `guild.id` (no setter in v1, mirroring the user avatar).
 */
export const guild = sqliteTable("guild", {
  // TODO: can move to a DB-generated uuid later
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * GuildRole — a role within one guild. Every guild seeds exactly one row,
 * `isDefault: true`, standing in for the implicit `@everyone` (identified by the FLAG,
 * never the name string). `permissions` is the RBAC bitfield (ADR 0008): a plain JS
 * number whose bit meanings live in `@konus-la/api/permissions` — this package traffics
 * in raw integers only. Default 0 = grants nothing, so seeding stays behavior-preserving.
 * `color` is `#rrggbb`; null = uncolored (no tint contribution). Higher `position` =
 * higher rank; `@everyone` is pinned at 0.
 */
export const guildRole = sqliteTable("guild_role", {
  // TODO: can move to a DB-generated uuid later
  id: text("id").primaryKey(),
  guildId: text("guild_id")
    .notNull()
    .references(() => guild.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
  position: integer("position").default(0).notNull(),
  permissions: integer("permissions").default(0).notNull(),
  color: text("color"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

/**
 * GuildMembership — a user's membership in a guild. The owner holds a row like everyone
 * else. Membership ALONE means `@everyone`; no `memberRole` row is written for the default
 * role. PK `(userId, guildId)`. `serverMuted` is the persistent server-mute flag (charter 5):
 * it survives voice leave/join, guild switches, and server restarts — voice rooms are
 * in-memory (ADR 0007), the flag is not.
 */
export const guildMembership = sqliteTable(
  "guild_membership",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.id, { onDelete: "cascade" }),
    serverMuted: integer("server_muted", { mode: "boolean" }).default(false).notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId] }),
    index("guild_membership_guildId_idx").on(table.guildId),
  ],
);

/**
 * MemberRole — assignment of a non-default role to a member. EMPTY IN PHASE 2 (the
 * implicit `@everyone` is never materialised here). Exists so custom-role assignment is
 * purely additive later. PK `(userId, guildId, roleId)`; composite FK to the membership.
 */
export const memberRole = sqliteTable(
  "member_role",
  {
    userId: text("user_id").notNull(),
    guildId: text("guild_id").notNull(),
    roleId: text("role_id")
      .notNull()
      .references(() => guildRole.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId, table.roleId] }),
    foreignKey({
      columns: [table.userId, table.guildId],
      foreignColumns: [guildMembership.userId, guildMembership.guildId],
    }).onDelete("cascade"),
  ],
);

/**
 * GuildInvite — a shareable, multi-use invite code for one guild. Time-only: `expiresAt`
 * (nullable = never expires) is the only enforced limit — there is no `maxUses` cap.
 * `usedCount` is display-only. Revoke = hard-delete.
 */
export const guildInvite = sqliteTable(
  "guild_invite",
  {
    // TODO: can move to a DB-generated uuid later
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    usedCount: integer("used_count").default(0).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("guild_invite_code_idx").on(table.code)],
);

/**
 * GuildBan — a user barred from rejoining a guild. A ban beats an invite: `consumeInvite`
 * checks this table before inserting a membership. PK `(guildId, userId)`.
 */
export const guildBan = sqliteTable(
  "guild_ban",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guild.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason"),
    bannedByUserId: text("banned_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const guildRelations = relations(guild, ({ one, many }) => ({
  owner: one(user, {
    fields: [guild.ownerId],
    references: [user.id],
    relationName: "guildOwner",
  }),
  roles: many(guildRole),
  memberships: many(guildMembership),
  invites: many(guildInvite),
  bans: many(guildBan),
}));

export const guildRoleRelations = relations(guildRole, ({ one }) => ({
  guild: one(guild, {
    fields: [guildRole.guildId],
    references: [guild.id],
  }),
}));

export const guildMembershipRelations = relations(guildMembership, ({ one }) => ({
  guild: one(guild, {
    fields: [guildMembership.guildId],
    references: [guild.id],
  }),
  user: one(user, {
    fields: [guildMembership.userId],
    references: [user.id],
    relationName: "membershipUser",
  }),
}));

export const guildInviteRelations = relations(guildInvite, ({ one }) => ({
  guild: one(guild, {
    fields: [guildInvite.guildId],
    references: [guild.id],
  }),
  createdBy: one(user, {
    fields: [guildInvite.createdByUserId],
    references: [user.id],
    relationName: "inviteCreatedBy",
  }),
}));

export const guildBanRelations = relations(guildBan, ({ one }) => ({
  guild: one(guild, {
    fields: [guildBan.guildId],
    references: [guild.id],
  }),
  user: one(user, {
    fields: [guildBan.userId],
    references: [user.id],
    relationName: "banUser",
  }),
  bannedBy: one(user, {
    fields: [guildBan.bannedByUserId],
    references: [user.id],
    relationName: "banBannedBy",
  }),
}));
