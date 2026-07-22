import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";

import { db } from "./index";
import { migrationsFolder } from "./migrate";
import { dmPairKeyFor } from "./queries/dm";
import { user } from "./schema/auth";
import { channel, channelParticipant } from "./schema/channel";
import { guildMembership, guildRole, memberRole } from "./schema/guild";

/**
 * Test-only helpers, imported by vitest setups/suites — never by app code. They live in
 * this package so consumers (e.g. `@konus-la/api` tests) stay free of a direct
 * `drizzle-orm` dependency, same rule as the query helpers.
 */

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

/** Write the admin-plugin ban columns — for the test-side Better Auth fake, never suites. */
export async function setTestUserBan(
  userId: string,
  ban: { banned: boolean; banReason: string | null },
): Promise<void> {
  await db
    .update(user)
    .set({ banned: ban.banned, banReason: ban.banReason, banExpires: null })
    .where(eq(user.id, userId));
}

/** Add an existing user to an existing guild (skips the invite flow). */
export async function seedTestMembership(guildId: string, userId: string): Promise<void> {
  await db.insert(guildMembership).values({ guildId, userId });
}

/**
 * Insert a custom (non-default) role, skipping the role router on purpose — for suites
 * that need roles as fixtures (permission gates, hierarchy), not as the thing under test.
 */
export async function seedTestRole(input: {
  guildId: string;
  name: string;
  position: number;
  permissions?: number;
  color?: string | null;
}): Promise<string> {
  const roleId = crypto.randomUUID();
  await db.insert(guildRole).values({
    id: roleId,
    guildId: input.guildId,
    name: input.name,
    position: input.position,
    permissions: input.permissions ?? 0,
    color: input.color ?? null,
  });
  return roleId;
}

/** Assign a seeded role to a member (skips the not-yet-built role router). */
export async function seedTestMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await db.insert(memberRole).values({ guildId, userId, roleId });
}

/** Flip a membership's persistent server-mute flag (skips the not-yet-built mod router). */
export async function setTestServerMuted(
  guildId: string,
  userId: string,
  serverMuted: boolean,
): Promise<void> {
  await db
    .update(guildMembership)
    .set({ serverMuted })
    .where(and(eq(guildMembership.guildId, guildId), eq(guildMembership.userId, userId)));
}

/** Overwrite the `@everyone` row's bitfield (identified by `isDefault`, never the name). */
export async function setTestEveryonePermissions(
  guildId: string,
  permissions: number,
): Promise<void> {
  await db
    .update(guildRole)
    .set({ permissions })
    .where(and(eq(guildRole.guildId, guildId), eq(guildRole.isDefault, true)));
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
