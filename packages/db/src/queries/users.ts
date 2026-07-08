import { and, asc, eq, ne, or, sql } from "drizzle-orm";

import { db } from "../index";
import { user } from "../schema/auth";

/** Total number of registered users. Drives the first-user-becomes-owner bootstrap. */
export async function countUsers(): Promise<number> {
  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(user);
  return countRow?.count ?? 0;
}

/** True when a user already owns this (lowercased) username. */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.username, username))
    .limit(1);
  return Boolean(existingUser);
}

/** Update the mutable displayName (`user.name`) for one user. */
export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  await db.update(user).set({ name: displayName }).where(eq(user.id, userId));
}

/** Escape LIKE wildcards so user-typed queries match literally (paired with ESCAPE '\'). */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The profile columns every public user projection shares (`user.name` IS the displayName). */
export const publicUserColumns = {
  username: user.username,
  displayName: user.name,
  image: user.image,
};

/**
 * Instance-wide user directory: prefix match on username OR displayName, excluding the
 * caller. Powers the new-DM and group-participant pickers.
 */
export async function searchUsers(input: { query: string; limit: number; excludeUserId: string }) {
  const pattern = `${escapeLikePattern(input.query)}%`;
  return db
    .select({ id: user.id, ...publicUserColumns })
    .from(user)
    .where(
      and(
        or(
          sql`${user.username} LIKE ${pattern} ESCAPE '\\'`,
          sql`${user.name} LIKE ${pattern} ESCAPE '\\'`,
        ),
        ne(user.id, input.excludeUserId),
      ),
    )
    .orderBy(asc(user.username))
    .limit(input.limit);
}

/** Public profile shape for one user (DM draft headers etc.). */
export async function getPublicUser(userId: string) {
  const [row] = await db
    .select({ id: user.id, ...publicUserColumns })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row;
}
