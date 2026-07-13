import { createChannel, createGuildWithOwner } from "@konus-la/db";
import {
  seedTestDmChannel,
  seedTestMembership,
  seedTestUser,
  seedTestVoiceChannel,
} from "@konus-la/db/testing";
import { call } from "@orpc/server";
import * as mediasoup from "mediasoup";
import type { types } from "mediasoup";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { asUser, asWsUser, collect, expectCode, ofType, settle, stopCollectors, waitFor } from "../testing";
import {
  evictGuildVoiceRooms,
  evictVoiceRoom,
  resetVoiceStateForTests,
  voiceAudioLevelObserverForTests,
  voiceConnectionClosed,
  voiceSnapshotFor,
  voiceWorkerDied,
  voiceWorkerRespawned,
} from "../voice/rooms";
import { setSfuWorker } from "../voice/sfu";
import { appRouter } from "./index";

/**
 * `voice.join` and `voice.leave` share one 10-per-60s budget per user, and the in-memory
 * limiter has no reset — each describe block below gets its own primary actor so no
 * single budget crosses the cap over the whole file.
 */
const ALICE = "v-alice"; // owner of the voice guild
const BOB = "v-bob";
const CARA = "v-cara";
const DAN = "v-dan";
const ERIN = "v-erin";
const FRED = "v-fred"; // dedicated to the join/leave rate-limit test
const GINA = "v-gina"; // dedicated to the flags rate-limit test
const HANK = "v-hank";
const IVY = "v-ivy";
const JACK = "v-jack";
const MALLORY = "v-mallory"; // member of the OTHER guild only

let guildId: string;
let vcMain: string;
let vcOther: string;
let vcElsewhere: string; // in Mallory's guild
let textChannelId: string;
let dmChannelId: string;

// `voice.join` now builds each room's router lazily, so occupancy tests need a real
// worker too (vitest runs under Node — no Bun spawn patch required).
let worker: types.Worker;

beforeAll(async () => {
  worker = await mediasoup.createWorker({ logLevel: "error" });
  setSfuWorker(() => worker);

  await seedTestUser({ id: ALICE, username: "v-alice" });
  await seedTestUser({ id: BOB, username: "v-bob" });
  await seedTestUser({ id: CARA, username: "v-cara" });
  await seedTestUser({ id: DAN, username: "v-dan" });
  await seedTestUser({ id: ERIN, username: "v-erin" });
  await seedTestUser({ id: FRED, username: "v-fred" });
  await seedTestUser({ id: GINA, username: "v-gina" });
  await seedTestUser({ id: HANK, username: "v-hank" });
  await seedTestUser({ id: IVY, username: "v-ivy" });
  await seedTestUser({ id: JACK, username: "v-jack" });
  await seedTestUser({ id: MALLORY, username: "v-mallory" });

  guildId = (await createGuildWithOwner({ name: "Voicers", ownerUserId: ALICE })).id;
  for (const member of [BOB, CARA, DAN, ERIN, FRED, GINA, HANK, IVY, JACK]) {
    await seedTestMembership(guildId, member);
  }

  const otherGuildId = (await createGuildWithOwner({ name: "Elsewhere", ownerUserId: MALLORY })).id;
  vcElsewhere = await seedTestVoiceChannel(otherGuildId, "voice-elsewhere");

  vcMain = await seedTestVoiceChannel(guildId, "voice-main");
  vcOther = await seedTestVoiceChannel(guildId, "voice-other");
  textChannelId = (await createChannel({ guildId, name: "chat", kind: "text" })).id;
  dmChannelId = await seedTestDmChannel({ isGroup: false, participantIds: [ALICE, BOB] });
});

afterEach(() => {
  stopCollectors();
  resetVoiceStateForTests();
});

afterAll(() => {
  worker.close();
});

// --- tests -------------------------------------------------------------------------------

describe("voice transport gate", () => {
  test("every voice.* procedure rejects calls without connection-scoped context (fetch /rpc)", async () => {
    // ALICE is a member of vcMain's guild, so FORBIDDEN here can only be the transport gate.
    await expectCode(call(appRouter.voice.join, { channelId: vcMain }, asUser(ALICE)), "FORBIDDEN");
    await expectCode(call(appRouter.voice.leave, undefined, asUser(ALICE)), "FORBIDDEN");
    await expectCode(
      call(appRouter.voice.setSelfMute, { muted: true }, asUser(ALICE)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.voice.setSelfDeaf, { deafened: true }, asUser(ALICE)),
      "FORBIDDEN",
    );
  });
});

describe("voice.join — fresh join", () => {
  test("takes a seat and publishes peerJoined guild-wide, not beyond the guild", async () => {
    const bob = collect(BOB);
    const mallory = collect(MALLORY);

    const result = await call(
      appRouter.voice.join,
      { channelId: vcMain },
      asWsUser(ALICE, "conn-a1"),
    );
    expect(result.seatSessionId).toEqual(expect.any(String));

    await waitFor(() => ofType(bob, "voice.peerJoined").length === 1, "peerJoined to co-member");
    expect(ofType(bob, "voice.peerJoined")[0]).toMatchObject({
      guildId,
      channelId: vcMain,
      userId: ALICE,
      selfMute: false,
      selfDeaf: false,
    });

    await settle();
    expect(ofType(mallory, "voice.peerJoined")).toHaveLength(0);
  });

  test("rejects text channels and DM channels", async () => {
    await expectCode(
      call(appRouter.voice.join, { channelId: textChannelId }, asWsUser(ALICE, "conn-a2")),
      "NOT_FOUND",
    );
    await expectCode(
      call(appRouter.voice.join, { channelId: dmChannelId }, asWsUser(ALICE, "conn-a2")),
      "NOT_FOUND",
    );
  });

  test("non-members cannot join (no-peek FORBIDDEN)", async () => {
    await expectCode(
      call(appRouter.voice.join, { channelId: vcMain }, asWsUser(MALLORY, "conn-m1")),
      "FORBIDDEN",
    );
  });
});

describe("voice.leave", () => {
  test("publishes peerLeft immediately and is idempotent", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(BOB, "conn-b1"));
    const alice = collect(ALICE);

    await call(appRouter.voice.leave, undefined, asWsUser(BOB, "conn-b1"));
    await waitFor(() => ofType(alice, "voice.peerLeft").length === 1, "peerLeft after leave");
    expect(ofType(alice, "voice.peerLeft")[0]).toMatchObject({
      guildId,
      channelId: vcMain,
      userId: BOB,
    });

    await call(appRouter.voice.leave, undefined, asWsUser(BOB, "conn-b1"));
    await settle();
    expect(ofType(alice, "voice.peerLeft")).toHaveLength(1);
  });
});

describe("voice self flags", () => {
  test("setSelfMute broadcasts peerMutedSelf guild-wide", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(CARA, "conn-c1"));
    const alice = collect(ALICE);

    await call(appRouter.voice.setSelfMute, { muted: true }, asWsUser(CARA, "conn-c1"));
    await waitFor(() => ofType(alice, "voice.peerMutedSelf").length === 1, "peerMutedSelf");
    expect(ofType(alice, "voice.peerMutedSelf")[0]).toMatchObject({
      guildId,
      channelId: vcMain,
      userId: CARA,
      selfMute: true,
    });
  });

  test("setSelfDeaf broadcasts peerDeafenedSelf guild-wide", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(CARA, "conn-c2"));
    const alice = collect(ALICE);

    await call(appRouter.voice.setSelfDeaf, { deafened: true }, asWsUser(CARA, "conn-c2"));
    await waitFor(() => ofType(alice, "voice.peerDeafenedSelf").length === 1, "peerDeafenedSelf");
    expect(ofType(alice, "voice.peerDeafenedSelf")[0]).toMatchObject({
      guildId,
      channelId: vcMain,
      userId: CARA,
      selfDeaf: true,
    });
  });

  test("flag setters without a seat throw VOICE_INVALID_STATE", async () => {
    await expectCode(
      call(appRouter.voice.setSelfMute, { muted: true }, asWsUser(BOB, "conn-b9")),
      "VOICE_INVALID_STATE",
    );
    await expectCode(
      call(appRouter.voice.setSelfDeaf, { deafened: true }, asWsUser(BOB, "conn-b9")),
      "VOICE_INVALID_STATE",
    );
  });
});

describe("voice.join — channel switch", () => {
  test("implicit unseat: peerLeft(A) + peerJoined(B), flags carried, no sessionReplaced", async () => {
    const alice = collect(ALICE);
    const dan = collect(DAN);

    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(DAN, "conn-d1"));
    await call(appRouter.voice.setSelfMute, { muted: true }, asWsUser(DAN, "conn-d1"));
    await call(appRouter.voice.join, { channelId: vcOther }, asWsUser(DAN, "conn-d1"));

    await waitFor(() => ofType(alice, "voice.peerJoined").length === 2, "peerJoined in B");
    expect(ofType(alice, "voice.peerLeft")).toEqual([
      expect.objectContaining({ guildId, channelId: vcMain, userId: DAN }),
    ]);
    expect(ofType(alice, "voice.peerJoined")[1]).toMatchObject({
      guildId,
      channelId: vcOther,
      userId: DAN,
      selfMute: true, // carried across the switch — no unmuted flash in the sidebar
      selfDeaf: false,
    });

    await settle();
    // Same socket moved itself: nobody's session was stolen.
    expect(ofType(dan, "voice.sessionReplaced")).toHaveLength(0);
  });
});

describe("voice grace (involuntary socket loss)", () => {
  test("socket drop publishes nothing guild-wide; the seat stays visible", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(ERIN, "conn-e1"));
    const alice = collect(ALICE);

    voiceConnectionClosed("conn-e1");

    await settle();
    expect(ofType(alice, "voice.peerLeft")).toHaveLength(0);
    expect(await voiceSnapshotFor(ALICE)).toEqual([
      expect.objectContaining({
        channelId: vcMain,
        seats: [expect.objectContaining({ userId: ERIN })],
      }),
    ]);
  });

  test("grace expiry publishes peerLeft and GCs the room", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(ERIN, "conn-e2"));
    const alice = collect(ALICE);

    voiceConnectionClosed("conn-e2", 30);

    await waitFor(() => ofType(alice, "voice.peerLeft").length === 1, "peerLeft on expiry");
    expect(ofType(alice, "voice.peerLeft")[0]).toMatchObject({
      guildId,
      channelId: vcMain,
      userId: ERIN,
    });
    expect(await voiceSnapshotFor(ALICE)).toHaveLength(0); // last seat out → room GC'd
  });

  test("rebind within grace: new session id, timer cancelled, nothing published", async () => {
    const first = await call(
      appRouter.voice.join,
      { channelId: vcMain },
      asWsUser(ERIN, "conn-e3"),
    );
    voiceConnectionClosed("conn-e3", 50);
    const alice = collect(ALICE);
    const erin = collect(ERIN);

    const second = await call(
      appRouter.voice.join,
      { channelId: vcMain },
      asWsUser(ERIN, "conn-e4"),
    );
    expect(second.seatSessionId).not.toBe(first.seatSessionId);

    // Outlive the would-be grace expiry: the cancelled timer must not fire.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(ofType(alice, "voice.peerLeft")).toHaveLength(0);
    expect(ofType(alice, "voice.peerJoined")).toHaveLength(0);
    expect(ofType(erin, "voice.sessionReplaced")).toHaveLength(0);
  });
});

describe("voice multi-tab steal", () => {
  test("same channel: self-only sessionReplaced names the loser, nothing guild-wide", async () => {
    const first = await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(DAN, "conn-d2"));
    const alice = collect(ALICE);
    const dan = collect(DAN);

    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(DAN, "conn-d3"));

    await waitFor(() => ofType(dan, "voice.sessionReplaced").length === 1, "sessionReplaced");
    expect(ofType(dan, "voice.sessionReplaced")[0]).toMatchObject({
      channelId: vcMain,
      replacedSeatSessionId: first.seatSessionId,
    });

    await settle();
    expect(ofType(alice, "voice.peerJoined")).toHaveLength(0);
    expect(ofType(alice, "voice.peerLeft")).toHaveLength(0);
    expect(ofType(alice, "voice.sessionReplaced")).toHaveLength(0); // self-only, not guild-wide
  });

  test("cross-channel steal: guild sees the move, loser tab gets sessionReplaced", async () => {
    const first = await call(
      appRouter.voice.join,
      { channelId: vcMain },
      asWsUser(ERIN, "conn-e5"),
    );
    const alice = collect(ALICE);
    const erin = collect(ERIN);

    await call(appRouter.voice.join, { channelId: vcOther }, asWsUser(ERIN, "conn-e6"));

    await waitFor(() => ofType(alice, "voice.peerJoined").length === 1, "peerJoined in B");
    expect(ofType(alice, "voice.peerLeft")[0]).toMatchObject({ channelId: vcMain, userId: ERIN });
    expect(ofType(alice, "voice.peerJoined")[0]).toMatchObject({
      channelId: vcOther,
      userId: ERIN,
    });
    await waitFor(() => ofType(erin, "voice.sessionReplaced").length === 1, "sessionReplaced");
    expect(ofType(erin, "voice.sessionReplaced")[0]).toMatchObject({
      channelId: vcMain,
      replacedSeatSessionId: first.seatSessionId,
    });
  });
});

describe("voice.snapshot", () => {
  test("realtime.events yields it right after presence.snapshot, scoped to the subscriber's guilds", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(HANK, "conn-h1"));
    await call(appRouter.voice.setSelfMute, { muted: true }, asWsUser(HANK, "conn-h1"));
    // Occupancy in a guild BOB doesn't belong to must not leak into his snapshot.
    await call(appRouter.voice.join, { channelId: vcElsewhere }, asWsUser(MALLORY, "conn-m2"));

    // A fresh subscription IS the reconnect story: the snapshot must match memory.
    const iterator = await call(appRouter.realtime.events, undefined, asUser(BOB));
    try {
      const first = await iterator.next();
      const second = await iterator.next();
      expect(first.value).toMatchObject({ type: "presence.snapshot" });
      expect(second.value).toMatchObject({
        type: "voice.snapshot",
        rooms: [
          {
            guildId,
            channelId: vcMain,
            seats: [{ userId: HANK, selfMute: true, selfDeaf: false }],
            speakingUserIds: [],
          },
        ],
      });
    } finally {
      await iterator.return?.(undefined);
    }
  });
});

describe("voice worker death & respawn", () => {
  test("death graces every live seat silently; respawn publishes mediaReset self-only", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(IVY, "conn-i1"));
    await call(appRouter.voice.join, { channelId: vcOther }, asWsUser(JACK, "conn-j1"));
    const alice = collect(ALICE);
    const ivy = collect(IVY);
    const jack = collect(JACK);

    voiceWorkerDied(800);
    await settle();
    expect(ofType(alice, "voice.peerLeft")).toHaveLength(0); // guild-wide silence

    await voiceWorkerRespawned();
    await waitFor(() => ofType(ivy, "voice.mediaReset").length === 1, "ivy mediaReset");
    expect(ofType(ivy, "voice.mediaReset")[0]).toMatchObject({ channelId: vcMain });
    await waitFor(() => ofType(jack, "voice.mediaReset").length === 1, "jack mediaReset");
    expect(ofType(jack, "voice.mediaReset")[0]).toMatchObject({ channelId: vcOther });
    expect(ofType(alice, "voice.mediaReset")).toHaveLength(0); // self-only

    // IVY's client answers mediaReset with voice.join (grace rebind); JACK's never comes
    // back and expires through the normal grace path.
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(IVY, "conn-i2"));
    await waitFor(() => ofType(alice, "voice.peerLeft").length === 1, "jack grace expiry", 3_000);
    expect(ofType(alice, "voice.peerLeft")[0]).toMatchObject({
      channelId: vcOther,
      userId: JACK,
    });
    expect(await voiceSnapshotFor(ALICE)).toEqual([
      expect.objectContaining({
        channelId: vcMain,
        seats: [expect.objectContaining({ userId: IVY })],
      }),
    ]);
  });
});

describe("voice room capacity", () => {
  test("a full room rejects the 21st fresh seat but never its own members' rebinds", async () => {
    // Dedicated guild so the fill doesn't pollute the main fixtures' budgets or rooms.
    const owner = "v-cap-0";
    await seedTestUser({ id: owner, username: "v-cap-0" });
    const capGuildId = (await createGuildWithOwner({ name: "Packed", ownerUserId: owner })).id;
    const vcPacked = await seedTestVoiceChannel(capGuildId, "voice-packed");

    const members = [owner];
    for (let i = 1; i < 20; i++) {
      const id = `v-cap-${i}`;
      members.push(id);
      await seedTestUser({ id, username: id });
      await seedTestMembership(capGuildId, id);
    }
    for (const member of members) {
      await call(appRouter.voice.join, { channelId: vcPacked }, asWsUser(member, `conn-${member}`));
    }

    const straggler = "v-cap-20";
    await seedTestUser({ id: straggler, username: straggler });
    await seedTestMembership(capGuildId, straggler);
    await expectCode(
      call(appRouter.voice.join, { channelId: vcPacked }, asWsUser(straggler, "conn-cap-20")),
      "CONFLICT",
    );

    // A seated user re-joining (steal/rebind) occupies no new seat — always allowed.
    const rebound = await call(
      appRouter.voice.join,
      { channelId: vcPacked },
      asWsUser(owner, "conn-cap-0b"),
    );
    expect(rebound.seatSessionId).toEqual(expect.any(String));
  });
});

describe("voice server restart", () => {
  test("rooms are memory: after a restart the snapshot is empty and rejoin lands as a fresh join", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(HANK, "conn-h2"));
    resetVoiceStateForTests(); // a restart IS this: every room gone, nothing persisted

    const iterator = await call(appRouter.realtime.events, undefined, asUser(HANK));
    try {
      await iterator.next(); // presence.snapshot
      const second = await iterator.next();
      expect(second.value).toMatchObject({ type: "voice.snapshot", rooms: [] });
    } finally {
      await iterator.return?.(undefined);
    }

    // The recovery move is the same voice.join, landing as a fresh join.
    const alice = collect(ALICE);
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(HANK, "conn-h3"));
    await waitFor(() => ofType(alice, "voice.peerJoined").length === 1, "fresh peerJoined");
    expect(ofType(alice, "voice.peerJoined")[0]).toMatchObject({
      channelId: vcMain,
      userId: HANK,
      selfMute: false, // nothing stale survives — flags reset with the room
      selfDeaf: false,
    });
  });
});

describe("voice room eviction on deletion", () => {
  /**
   * Deleting a channel/guild lives in the channel + guild routers, but its assertions belong
   * here: this is the only test file that boots a real SFU worker, and a `voice.join` without
   * one fails at router creation. Throwaway channels and dedicated users throughout —
   * join/leave shares a per-user budget with no reset between tests.
   */
  test("deleting a voice channel empties the room, GCs it, and evicts silently", async () => {
    const doomed = await seedTestVoiceChannel(guildId, "voice-doomed");
    const [kit, lena] = ["v-kit", "v-lena"];
    for (const id of [kit, lena]) {
      await seedTestUser({ id, username: id });
      await seedTestMembership(guildId, id);
    }
    await call(appRouter.voice.join, { channelId: doomed }, asWsUser(kit, "conn-kit-1"));
    await call(appRouter.voice.join, { channelId: doomed }, asWsUser(lena, "conn-lena-1"));
    expect(voiceAudioLevelObserverForTests(doomed)).not.toBeNull();

    const alice = collect(ALICE);
    const kitEvents = collect(kit);

    await call(appRouter.channel.delete, { guildId, channelId: doomed }, asUser(ALICE));

    await waitFor(() => ofType(alice, "channel.deleted").length === 1, "channel.deleted");
    await settle();
    // `channel.deleted` is the single client signal — a per-user peerLeft would race it.
    expect(ofType(alice, "voice.peerLeft")).toHaveLength(0);
    expect(ofType(kitEvents, "voice.peerLeft")).toHaveLength(0);
    expect(ofType(alice, "channel.deleted")).toEqual([
      expect.objectContaining({ guildId, channelId: doomed }),
    ]);

    // Both seats gone, the room GC'd, its SFU router closed (cascading to the observer).
    expect(await voiceSnapshotFor(ALICE)).toHaveLength(0);
    expect(voiceAudioLevelObserverForTests(doomed)).toBeNull();

    // The one-seat-per-user index is released: an evicted user can join elsewhere at once.
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(kit, "conn-kit-2"));
    expect(await voiceSnapshotFor(ALICE)).toEqual([
      expect.objectContaining({
        channelId: vcMain,
        seats: [expect.objectContaining({ userId: kit })],
      }),
    ]);
  });

  test("deleting a text channel leaves voice rooms alone", async () => {
    const nina = "v-nina";
    await seedTestUser({ id: nina, username: nina });
    await seedTestMembership(guildId, nina);
    const chatter = await createChannel({ guildId, name: "chatter", kind: "text" });
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(nina, "conn-nina-1"));

    await call(appRouter.channel.delete, { guildId, channelId: chatter.id }, asUser(ALICE));

    await settle();
    expect(await voiceSnapshotFor(ALICE)).toEqual([
      expect.objectContaining({
        channelId: vcMain,
        seats: [expect.objectContaining({ userId: nina })],
      }),
    ]);
  });

  test("deleting a guild evicts the voice rooms of its channels", async () => {
    // The evicted member belongs to the MAIN guild too: after the doomed guild is gone, their
    // own snapshot is empty whether or not eviction ran (the membership row cascaded away), so
    // the seat index has to be probed by joining elsewhere instead.
    const owner = "v-doomed-owner";
    const member = "v-doomed-member";
    for (const id of [owner, member]) await seedTestUser({ id, username: id });
    await seedTestMembership(guildId, member);
    const doomedGuildId = (await createGuildWithOwner({ name: "Doomed", ownerUserId: owner })).id;
    await seedTestMembership(doomedGuildId, member);
    const vcDoomed = await seedTestVoiceChannel(doomedGuildId, "voice-doomed-guild");

    await call(appRouter.voice.join, { channelId: vcDoomed }, asWsUser(member, "conn-dm-1"));
    expect(voiceAudioLevelObserverForTests(vcDoomed)).not.toBeNull();

    await call(appRouter.guild.delete, { guildId: doomedGuildId }, asUser(owner));

    // The room is gone with its SFU router (the observer dies with it)...
    expect(voiceAudioLevelObserverForTests(vcDoomed)).toBeNull();
    // ...and the seat it held is released, so the member can sit down elsewhere immediately.
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(member, "conn-dm-2"));
    expect(await voiceSnapshotFor(ALICE)).toEqual([
      expect.objectContaining({
        channelId: vcMain,
        seats: [expect.objectContaining({ userId: member })],
      }),
    ]);
  });

  test("evicting an unknown room is a no-op, and eviction is idempotent", () => {
    expect(() => evictVoiceRoom("no-such-channel")).not.toThrow();
    expect(() => evictGuildVoiceRooms("no-such-guild")).not.toThrow();
    expect(() => evictVoiceRoom(vcMain)).not.toThrow();
    expect(() => evictVoiceRoom(vcMain)).not.toThrow();
  });
});

describe("voice rate limits", () => {
  test("join and leave share one 10-per-60s budget", async () => {
    for (let i = 0; i < 5; i++) {
      await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(FRED, "conn-f1"));
      await call(appRouter.voice.leave, undefined, asWsUser(FRED, "conn-f1"));
    }
    await expectCode(
      call(appRouter.voice.join, { channelId: vcMain }, asWsUser(FRED, "conn-f1")),
      "TOO_MANY_REQUESTS",
    );
  });

  test("setSelfMute and setSelfDeaf share one 10-per-10s budget", async () => {
    await call(appRouter.voice.join, { channelId: vcMain }, asWsUser(GINA, "conn-g1"));
    for (let i = 0; i < 5; i++) {
      await call(appRouter.voice.setSelfMute, { muted: i % 2 === 0 }, asWsUser(GINA, "conn-g1"));
      await call(appRouter.voice.setSelfDeaf, { deafened: i % 2 === 0 }, asWsUser(GINA, "conn-g1"));
    }
    await expectCode(
      call(appRouter.voice.setSelfMute, { muted: true }, asWsUser(GINA, "conn-g1")),
      "TOO_MANY_REQUESTS",
    );
  });
});
