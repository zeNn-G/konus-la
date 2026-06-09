import { eq, sql } from "drizzle-orm";

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
