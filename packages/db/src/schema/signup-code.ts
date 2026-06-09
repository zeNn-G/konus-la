import { sql, relations } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * SignupCode — a single-use invitation token granting the right to register one account.
 * Minted by the Instance Owner; claimed atomically at signup (usedAt + usedByUserId set).
 * The zero-users bootstrap signup needs no code (see ADR 0001).
 */
export const signupCode = sqliteTable(
  "signup_code",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    usedByUserId: text("used_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("signup_code_code_idx").on(table.code)],
);

export const signupCodeRelations = relations(signupCode, ({ one }) => ({
  usedBy: one(user, {
    fields: [signupCode.usedByUserId],
    references: [user.id],
    relationName: "signupCodeUsedBy",
  }),
  createdBy: one(user, {
    fields: [signupCode.createdByUserId],
    references: [user.id],
    relationName: "signupCodeCreatedBy",
  }),
}));
