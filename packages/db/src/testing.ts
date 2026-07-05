import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";

import { db } from "./index";
import { user } from "./schema/auth";
import { guildMembership } from "./schema/guild";

/**
 * Test-only helpers, imported by vitest setups/suites — never by app code. They live in
 * this package so consumers (e.g. `@konus-la/api` tests) stay free of a direct
 * `drizzle-orm` dependency, same rule as the query helpers.
 */

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/** Bring the test db up to the latest migration. */
export async function applyMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/** Release the client's file handle so the temp db file can be removed on Windows. */
export function closeTestDb(): void {
  db.$client.close();
}

/** Insert a bare user row (no credentials — tests authenticate via the mocked session). */
export async function seedTestUser(input: {
  id: string;
  username: string;
  name?: string;
  role?: "admin" | "user";
}) {
  const [row] = await db
    .insert(user)
    .values({
      id: input.id,
      name: input.name ?? input.username,
      email: `${input.id}@test.local`,
      username: input.username,
      role: input.role ?? "user",
    })
    .returning();
  if (!row) throw new Error(`Failed to seed user ${input.id}`);
  return row;
}

export async function getTestUser(id: string) {
  const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return row ?? null;
}

/** Add an existing user to an existing guild (skips the invite flow). */
export async function seedTestMembership(guildId: string, userId: string): Promise<void> {
  await db.insert(guildMembership).values({ guildId, userId });
}
