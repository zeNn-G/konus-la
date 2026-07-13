import path from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";

import { db } from "./index";
import { dmPairKeyFor } from "./queries/dm";
import { user } from "./schema/auth";
import { channel, channelParticipant } from "./schema/channel";
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

/**
 * Insert a guild voice channel, skipping the channel router's owner gate on purpose — for
 * suites that need a voice channel as a fixture, not as the thing under test.
 */
export async function seedTestVoiceChannel(guildId: string, name: string): Promise<string> {
  const channelId = crypto.randomUUID();
  await db.insert(channel).values({ id: channelId, guildId, kind: "voice", name });
  return channelId;
}

/**
 * Insert a DM channel with its participant rows, bypassing the dm router. 1:1 channels
 * (`isGroup: false`) require exactly two participants and get their `dmPairKey` computed.
 * `joinedAtOffsetsMs` (parallel to `participantIds`) makes owner-transfer ordering
 * deterministic — offsets are added to a fixed base timestamp.
 */
export async function seedTestDmChannel(input: {
  isGroup: boolean;
  participantIds: string[];
  ownerId?: string;
  name?: string;
  joinedAtOffsetsMs?: number[];
}): Promise<string> {
  if (!input.isGroup && input.participantIds.length !== 2) {
    throw new Error("A seeded 1:1 DM needs exactly two participants");
  }
  const channelId = crypto.randomUUID();
  const base = Date.parse("2026-01-01T00:00:00Z");
  await db.insert(channel).values({
    id: channelId,
    kind: "dm",
    isGroup: input.isGroup,
    name: input.name ?? null,
    ownerId: input.isGroup ? (input.ownerId ?? input.participantIds[0]) : null,
    dmPairKey: input.isGroup
      ? null
      : dmPairKeyFor(input.participantIds[0] as string, input.participantIds[1] as string),
  });
  await db.insert(channelParticipant).values(
    input.participantIds.map((userId, i) => ({
      channelId,
      userId,
      joinedAt: new Date(base + (input.joinedAtOffsetsMs?.[i] ?? i * 1000)),
    })),
  );
  return channelId;
}
