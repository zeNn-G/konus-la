import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "../index";
import { user } from "../schema/auth";
import { signupCode } from "../schema/signup-code";
import { randomCode } from "../constants";

/**
 * A signup code that may still be claimed: exists, not yet used, and not expired.
 * Returns the row or undefined.
 */
export async function findUsableCode(code: string, now = new Date()) {
  const [matchedCode] = await db
    .select()
    .from(signupCode)
    .where(and(eq(signupCode.code, code), isNull(signupCode.usedAt)))
    .limit(1);
  if (!matchedCode) return undefined;
  if (matchedCode.expiresAt && matchedCode.expiresAt.getTime() <= now.getTime()) return undefined;
  return matchedCode;
}

/**
 * Atomically claim a code for a user. Conditional on `usedAt IS NULL` so two concurrent
 * signups racing the same code cannot both succeed. Returns true when this caller won the race.
 */
export async function consumeCode(code: string, userId: string): Promise<boolean> {
  const consumedCodes = await db
    .update(signupCode)
    .set({ usedAt: new Date(), usedByUserId: userId })
    .where(and(eq(signupCode.code, code), isNull(signupCode.usedAt)))
    .returning({ id: signupCode.id });
  return consumedCodes.length > 0;
}

/** Mint a new code. Returns the created row. */
export async function createCode(input: { createdByUserId: string; expiresAt?: Date | null }) {
  const [createdCode] = await db
    .insert(signupCode)
    .values({
      id: crypto.randomUUID(),
      code: randomCode(),
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!createdCode) throw new Error("Failed to create signup code.");
  return createdCode;
}

/** All codes, newest first, joined to the claiming user's username (when used). */
export async function listCodes() {
  return db
    .select({
      id: signupCode.id,
      code: signupCode.code,
      expiresAt: signupCode.expiresAt,
      usedAt: signupCode.usedAt,
      usedByUsername: user.username,
      createdAt: signupCode.createdAt,
    })
    .from(signupCode)
    .leftJoin(user, eq(signupCode.usedByUserId, user.id))
    .orderBy(desc(signupCode.createdAt));
}

/**
 * Revoke an unused code by deleting it. Returns true when a still-unused row was deleted
 * (already-used codes are kept as a claim record and cannot be revoked).
 */
export async function deleteUnusedCode(id: string): Promise<boolean> {
  const deletedCodes = await db
    .delete(signupCode)
    .where(and(eq(signupCode.id, id), isNull(signupCode.usedAt)))
    .returning({ id: signupCode.id });
  return deletedCodes.length > 0;
}
