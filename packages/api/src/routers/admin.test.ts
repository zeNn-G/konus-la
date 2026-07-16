import { createGuildWithOwner } from "@konus-la/db";
import { seedTestMembership, seedTestUser, seedTestVoiceChannel } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import * as mediasoup from "mediasoup";
import type { types } from "mediasoup";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { closeUserConnections, connectionOpened } from "../realtime/connections";
import {
  asNobody,
  asUser,
  asWsUser,
  collect,
  expectCode,
  fakeSocket,
  ofType,
  stopCollectors,
  waitFor,
} from "../testing";
import { resetVoiceStateForTests, voiceSnapshotFor } from "../voice/rooms";
import { setSfuWorker } from "../voice/sfu";
import { appRouter } from "./index";

/**
 * Instance-tier bans (issue #63, spec §admin router): Better Auth admin plugin behind
 * `adminProcedure`, plus the ban teardown (voice seat, live sockets). The Better Auth
 * fake in vitest.setup.ts mirrors the plugin's ban semantics against the test db.
 */

const ROOT = "ab-root"; // Instance Owner (global `admin` role)
const SECOND_ADMIN = "ab-admin2"; // a second admin-role user — never bannable
const TARGET = "ab-target";
const PLEB = "ab-pleb";

beforeAll(async () => {
  await seedTestUser({ id: ROOT, username: "ab_root", role: "admin" });
  await seedTestUser({ id: SECOND_ADMIN, username: "ab_admin2", role: "admin" });
  await seedTestUser({ id: TARGET, username: "ab_target" });
  await seedTestUser({ id: PLEB, username: "ab_pleb" });
});

describe("admin router gate", () => {
  test("non-admins → FORBIDDEN, unauthenticated → UNAUTHORIZED", async () => {
    const banInput = { userId: TARGET, reason: "spam" };
    await expectCode(call(appRouter.admin.banUser, banInput, asUser(PLEB)), "FORBIDDEN");
    await expectCode(call(appRouter.admin.unbanUser, { userId: TARGET }, asUser(PLEB)), "FORBIDDEN");
    await expectCode(call(appRouter.admin.listBannedUsers, undefined, asUser(PLEB)), "FORBIDDEN");
    await expectCode(call(appRouter.admin.banUser, banInput, asNobody()), "UNAUTHORIZED");
  });
});

describe("admin.banUser", () => {
  test("bans with the reason on record and force-closes the target's live sockets", async () => {
    const targetTab = fakeSocket();
    const adminTab = fakeSocket();
    connectionOpened(TARGET, targetTab);
    connectionOpened(ROOT, adminTab);

    await expect(
      call(appRouter.admin.banUser, { userId: TARGET, reason: "ban evasion" }, asUser(ROOT)),
    ).resolves.toEqual({ ok: true });

    const banned = await call(appRouter.admin.listBannedUsers, undefined, asUser(ROOT));
    expect(banned).toEqual([
      expect.objectContaining({ id: TARGET, username: "ab_target", banReason: "ban evasion" }),
    ]);

    expect(targetTab.closed).toBe(true);
    expect(adminTab.closed).toBe(false); // only the target's sockets die

    closeUserConnections(ROOT);
    await call(appRouter.admin.unbanUser, { userId: TARGET }, asUser(ROOT));
  });

  test("pre-guards: empty reason, self-ban, admin target, unknown target — all non-500", async () => {
    const ban = (input: { userId: string; reason: string }) =>
      call(appRouter.admin.banUser, input, asUser(ROOT));

    await expectCode(ban({ userId: TARGET, reason: "" }), "BAD_REQUEST");
    await expectCode(ban({ userId: TARGET, reason: "   " }), "BAD_REQUEST");
    await expectCode(ban({ userId: ROOT, reason: "oops" }), "BAD_REQUEST"); // self-ban
    await expectCode(ban({ userId: SECOND_ADMIN, reason: "coup" }), "FORBIDDEN"); // admin target
    await expectCode(ban({ userId: "no-such-user", reason: "ghost" }), "NOT_FOUND");
    await expectCode(
      call(appRouter.admin.unbanUser, { userId: "no-such-user" }, asUser(ROOT)),
      "NOT_FOUND",
    );

    // None of the rejects above stuck a ban.
    expect(await call(appRouter.admin.listBannedUsers, undefined, asUser(ROOT))).toEqual([]);
  });
});

describe("admin.banUser — seated target", () => {
  const SEATED = "ab-seated";
  let worker: types.Worker;
  let guildId: string;
  let voiceChannelId: string;

  beforeAll(async () => {
    worker = await mediasoup.createWorker({ logLevel: "error" });
    setSfuWorker(() => worker);

    await seedTestUser({ id: SEATED, username: "ab_seated" });
    guildId = (await createGuildWithOwner({ name: "Voice Ban Lab", ownerUserId: ROOT })).id;
    await seedTestMembership(guildId, SEATED);
    voiceChannelId = await seedTestVoiceChannel(guildId, "ban-voice");
  });

  afterEach(() => {
    stopCollectors();
    resetVoiceStateForTests();
  });

  afterAll(() => {
    worker.close();
  });

  test("releases the voice seat instance-wide — peerLeft flows to the remaining members", async () => {
    await call(appRouter.voice.join, { channelId: voiceChannelId }, asWsUser(SEATED, "ab-s1"));
    const ownerTab = collect(ROOT);

    await call(appRouter.admin.banUser, { userId: SEATED, reason: "seated ban" }, asUser(ROOT));

    await waitFor(() => ofType(ownerTab, "voice.peerLeft").length === 1, "peerLeft");
    expect(ofType(ownerTab, "voice.peerLeft")[0]).toMatchObject({
      guildId,
      channelId: voiceChannelId,
      userId: SEATED,
    });
    expect(await voiceSnapshotFor(ROOT)).toEqual([]);

    await call(appRouter.admin.unbanUser, { userId: SEATED }, asUser(ROOT));
  });
});

describe("admin.unbanUser", () => {
  test("restores access with memberships intact — the ban never touched them", async () => {
    const { id: guildId } = await createGuildWithOwner({
      name: "Ban Lab",
      ownerUserId: ROOT,
    });
    await seedTestMembership(guildId, TARGET);

    await call(appRouter.admin.banUser, { userId: TARGET, reason: "temporary" }, asUser(ROOT));
    await call(appRouter.admin.unbanUser, { userId: TARGET }, asUser(ROOT));

    expect(await call(appRouter.admin.listBannedUsers, undefined, asUser(ROOT))).toEqual([]);
    // The membership survived untouched: the target still sees the guild.
    const guilds = await call(appRouter.guild.list, undefined, asUser(TARGET));
    expect(guilds.map((row) => row.id)).toContain(guildId);
  });
});
