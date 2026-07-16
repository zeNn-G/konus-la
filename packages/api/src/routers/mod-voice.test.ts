import { createGuildWithOwner } from "@konus-la/db";
import {
  seedTestMembership,
  seedTestMemberRole,
  seedTestRole,
  seedTestUser,
  seedTestVoiceChannel,
} from "@konus-la/db/testing";
import * as mediasoup from "mediasoup";
import type { types } from "mediasoup";
import { call } from "@orpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { PERMISSIONS } from "../permissions";
import { asUser, asWsUser, collect, expectCode, ofType, stopCollectors, waitFor } from "../testing";
import { resetVoiceStateForTests, voicePeerForTests, voiceSnapshotFor } from "../voice/rooms";
import { setSfuWorker } from "../voice/sfu";
import { appRouter } from "./index";

/**
 * mod.serverMute + mod.disconnectVoice (issue #60): the persistent membership flag, its
 * voice-side enforcement, and the seat eviction. Seated cases run against a real mediasoup
 * worker (voice-media.test.ts precedent); the `modAction` budget is 30/60 s per actor, so
 * moderation-heavy describes get dedicated moderator actors.
 */

const OWNER = "mv-owner";
const MODERATOR = "mv-moderator"; // MUTE_MEMBERS + MOVE_MEMBERS at position 2
const PEER = "mv-peer"; // same bits at the same position — equal rank
const MEMBER = "mv-member"; // roleless target
const OUTSIDER = "mv-outsider"; // no membership

let worker: types.Worker;
let guildId: string;
let vcA: string;

afterEach(() => {
  stopCollectors();
  resetVoiceStateForTests();
});

afterAll(() => {
  worker.close();
});

beforeAll(async () => {
  worker = await mediasoup.createWorker({ logLevel: "error" });
  setSfuWorker(() => worker);

  await seedTestUser({ id: OWNER, username: OWNER });
  await seedTestUser({ id: MODERATOR, username: MODERATOR });
  await seedTestUser({ id: PEER, username: PEER });
  await seedTestUser({ id: MEMBER, username: MEMBER });
  await seedTestUser({ id: OUTSIDER, username: OUTSIDER });

  guildId = (await createGuildWithOwner({ name: "Voice Mod Lab", ownerUserId: OWNER })).id;
  await seedTestMembership(guildId, MODERATOR);
  await seedTestMembership(guildId, PEER);
  await seedTestMembership(guildId, MEMBER);
  const modRoleId = await seedTestRole({
    guildId,
    name: "voice-mods",
    position: 2,
    permissions: PERMISSIONS.MUTE_MEMBERS | PERMISSIONS.MOVE_MEMBERS,
  });
  await seedTestMemberRole(guildId, MODERATOR, modRoleId);
  const peerRoleId = await seedTestRole({
    guildId,
    name: "voice-mods-2",
    position: 2,
    permissions: PERMISSIONS.MUTE_MEMBERS | PERMISSIONS.MOVE_MEMBERS,
  });
  await seedTestMemberRole(guildId, PEER, peerRoleId);

  vcA = await seedTestVoiceChannel(guildId, "voice-a");
});

// --- client-side stand-ins (voice-media.test.ts precedent) ---------------------------------

/** Structurally valid DTLS parameters; the handshake itself never runs in these tests. */
const FAKE_DTLS: types.DtlsParameters = {
  role: "client",
  fingerprints: [
    {
      algorithm: "sha-256",
      value:
        "82:5A:68:3D:36:C3:0A:DE:AF:E7:32:43:D2:88:83:57:AC:2D:65:E5:80:C4:B6:FB:AF:1A:A0:21:9F:6D:0C:AD",
    },
  ],
};

function audioRtpParameters(ssrcValue: number): types.RtpParameters {
  return {
    mid: String(ssrcValue),
    codecs: [
      {
        mimeType: "audio/opus",
        payloadType: 111,
        clockRate: 48_000,
        channels: 2,
        parameters: { usedtx: 1, useinbandfec: 1 },
      },
    ],
    headerExtensions: [],
    encodings: [{ ssrc: ssrcValue }],
    rtcp: { cname: `cname-${ssrcValue}` },
  };
}

function videoRtpParameters(ssrcValue: number): types.RtpParameters {
  return {
    mid: String(ssrcValue),
    codecs: [{ mimeType: "video/VP8", payloadType: 96, clockRate: 90_000, parameters: {} }],
    headerExtensions: [],
    encodings: [{ ssrc: ssrcValue }],
    rtcp: { cname: `cname-${ssrcValue}` },
  };
}

let nextSsrc = 5000;
const ssrc = () => ++nextSsrc;

/** join → createTransport(send) → connectTransport: enough ceremony to produce. */
async function sendCeremony(userId: string, connectionId: string, channelId: string) {
  const ws = asWsUser(userId, connectionId);
  await call(appRouter.voice.join, { channelId }, ws);
  const send = await call(appRouter.voice.createTransport, { direction: "send" }, ws);
  await call(
    appRouter.voice.connectTransport,
    { transportId: send.id, dtlsParameters: FAKE_DTLS },
    ws,
  );
  return { ws, sendId: send.id };
}

function produceAs(
  ws: ReturnType<typeof asWsUser>,
  sendId: string,
  kind: "audio" | "video",
  source: "mic" | "cam" | "screen" | "screenAudio",
) {
  return call(
    appRouter.voice.produce,
    {
      transportId: sendId,
      kind,
      rtpParameters: kind === "audio" ? audioRtpParameters(ssrc()) : videoRtpParameters(ssrc()),
      source,
    },
    ws,
  );
}

/** The target's producer paused-flags by id, read off the server-side peer. */
function pausedOf(userId: string, producerId: string): boolean | undefined {
  return voicePeerForTests(userId)?.producers.get(producerId)?.producer.paused;
}

/** The target's membership flag as every client reads it — off `guild.get`. */
async function serverMutedOf(userId: string): Promise<boolean | undefined> {
  const { members } = await call(appRouter.guild.get, { guildId }, asUser(OWNER));
  return members.find((member) => member.userId === userId)?.serverMuted;
}

describe("mod.serverMute — unseated target", () => {
  test("sets the persistent flag and records a member.serverMute audit entry", async () => {
    await expect(
      call(
        appRouter.mod.serverMute,
        { guildId, userId: MEMBER, muted: true },
        asUser(MODERATOR),
      ),
    ).resolves.toEqual({ ok: true });
    expect(await serverMutedOf(MEMBER)).toBe(true);

    const page = await call(appRouter.auditLog.list, { guildId }, asUser(OWNER));
    expect(page.entries[0]).toMatchObject({
      action: "member.serverMute",
      actor: { id: MODERATOR },
      targetUser: { id: MEMBER },
      metadata: { muted: true },
    });

    await call(
      appRouter.mod.serverMute,
      { guildId, userId: MEMBER, muted: false },
      asUser(MODERATOR),
    );
    expect(await serverMutedOf(MEMBER)).toBe(false);
  });

  test("fans out voice.serverMuteSet with channelId null to all guild members", async () => {
    const memberTab = collect(MEMBER);
    await call(
      appRouter.mod.serverMute,
      { guildId, userId: MEMBER, muted: true },
      asUser(MODERATOR),
    );

    await waitFor(() => ofType(memberTab, "voice.serverMuteSet").length === 1, "serverMuteSet");
    expect(ofType(memberTab, "voice.serverMuteSet")[0]).toEqual({
      type: "voice.serverMuteSet",
      guildId,
      channelId: null,
      userId: MEMBER,
      serverMuted: true,
    });

    await call(
      appRouter.mod.serverMute,
      { guildId, userId: MEMBER, muted: false },
      asUser(MODERATOR),
    );
  });

  test("gates: no MUTE_MEMBERS, equal rank, owner target, self target → FORBIDDEN; non-member target → NOT_FOUND", async () => {
    const mute = (actorId: string, targetId: string) =>
      call(appRouter.mod.serverMute, { guildId, userId: targetId, muted: true }, asUser(actorId));

    await expectCode(mute(MEMBER, PEER), "FORBIDDEN"); // no permission
    await expectCode(mute(MODERATOR, PEER), "FORBIDDEN"); // equal rank
    await expectCode(mute(MODERATOR, OWNER), "FORBIDDEN"); // owner can never be targeted
    await expectCode(mute(MODERATOR, MODERATOR), "FORBIDDEN"); // self target
    await expectCode(mute(OUTSIDER, MEMBER), "FORBIDDEN"); // non-member actor
    await expectCode(mute(OWNER, OUTSIDER), "NOT_FOUND"); // non-member target
    expect(await serverMutedOf(PEER)).toBe(false); // nothing above stuck
  });
});

describe("mod.serverMute — seated target", () => {
  const DINO = "mv-dino"; // seated target producing mic + screenAudio + cam

  beforeAll(async () => {
    await seedTestUser({ id: DINO, username: DINO });
    await seedTestMembership(guildId, DINO);
  });

  test("pauses mic AND screenAudio producers, leaves cam; unmute resumes them without re-produce", async () => {
    const dino = await sendCeremony(DINO, "sm-d", vcA);
    const mic = await produceAs(dino.ws, dino.sendId, "audio", "mic");
    const share = await produceAs(dino.ws, dino.sendId, "audio", "screenAudio");
    const cam = await produceAs(dino.ws, dino.sendId, "video", "cam");
    const memberTab = collect(MEMBER);

    await call(appRouter.mod.serverMute, { guildId, userId: DINO, muted: true }, asUser(OWNER));

    expect(pausedOf(DINO, mic.producerId)).toBe(true);
    expect(pausedOf(DINO, share.producerId)).toBe(true);
    expect(pausedOf(DINO, cam.producerId)).toBe(false); // video is never a mute target

    // Seated flavor: the event names the seat's channel — the occupancy-patch signal.
    await waitFor(() => ofType(memberTab, "voice.serverMuteSet").length === 1, "serverMuteSet");
    expect(ofType(memberTab, "voice.serverMuteSet")[0]).toMatchObject({
      guildId,
      channelId: vcA,
      userId: DINO,
      serverMuted: true,
    });

    // Late subscribers render the badge straight off the snapshot seat.
    expect(await voiceSnapshotFor(OWNER)).toEqual([
      expect.objectContaining({
        channelId: vcA,
        seats: [expect.objectContaining({ userId: DINO, serverMuted: true })],
      }),
    ]);

    await call(appRouter.mod.serverMute, { guildId, userId: DINO, muted: false }, asUser(OWNER));
    expect(pausedOf(DINO, mic.producerId)).toBe(false);
    expect(pausedOf(DINO, share.producerId)).toBe(false);
  });
});

describe("mod.serverMute — no self-resume", () => {
  const EMMA = "mv-emma"; // muted while unseated, then joins and produces

  beforeAll(async () => {
    await seedTestUser({ id: EMMA, username: EMMA });
    await seedTestMembership(guildId, EMMA);
  });

  test("a muted member's fresh join seats serverMuted; audio producers are born paused, re-produce included", async () => {
    await call(appRouter.mod.serverMute, { guildId, userId: EMMA, muted: true }, asUser(OWNER));

    const memberTab = collect(MEMBER);
    const emma = await sendCeremony(EMMA, "nr-e", vcA);

    // The flag applied before any media flowed — the join announcement already carries it.
    await waitFor(() => ofType(memberTab, "voice.peerJoined").length === 1, "peerJoined");
    expect(ofType(memberTab, "voice.peerJoined")[0]).toMatchObject({
      channelId: vcA,
      userId: EMMA,
      serverMuted: true,
    });

    const mic = await produceAs(emma.ws, emma.sendId, "audio", "mic");
    expect(pausedOf(EMMA, mic.producerId)).toBe(true);
    const cam = await produceAs(emma.ws, emma.sendId, "video", "cam");
    expect(pausedOf(EMMA, cam.producerId)).toBe(false);

    // Close + re-produce is no escape: the fresh producer is born paused too.
    await call(appRouter.voice.closeProducer, { producerId: mic.producerId }, emma.ws);
    const again = await produceAs(emma.ws, emma.sendId, "audio", "mic");
    expect(pausedOf(EMMA, again.producerId)).toBe(true);

    await call(appRouter.mod.serverMute, { guildId, userId: EMMA, muted: false }, asUser(OWNER));
    expect(pausedOf(EMMA, again.producerId)).toBe(false);
  });
});

describe("mod.disconnectVoice", () => {
  const FINN = "mv-finn"; // seated target

  beforeAll(async () => {
    await seedTestUser({ id: FINN, username: FINN });
    await seedTestMembership(guildId, FINN);
  });

  test("evicts the seat — peerLeft flows naturally, the audit entry names the channel, rejoin works", async () => {
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(FINN, "dc-f1"));
    const memberTab = collect(MEMBER);

    await expect(
      call(appRouter.mod.disconnectVoice, { guildId, userId: FINN }, asUser(MODERATOR)),
    ).resolves.toEqual({ ok: true });

    await waitFor(() => ofType(memberTab, "voice.peerLeft").length === 1, "peerLeft");
    expect(ofType(memberTab, "voice.peerLeft")[0]).toMatchObject({
      guildId,
      channelId: vcA,
      userId: FINN,
    });
    expect(await voiceSnapshotFor(OWNER)).toEqual([]);

    const page = await call(appRouter.auditLog.list, { guildId }, asUser(OWNER));
    expect(page.entries[0]).toMatchObject({
      action: "member.voiceDisconnect",
      actor: { id: MODERATOR },
      targetUser: { id: FINN },
      targetChannelId: vcA,
      metadata: {},
    });

    // Not a ban: the target may rejoin immediately.
    await expect(
      call(appRouter.voice.join, { channelId: vcA }, asWsUser(FINN, "dc-f2")),
    ).resolves.toMatchObject({ seatSessionId: expect.any(String) });
  });

  test("unseated target → NOT_FOUND and no audit entry; gates mirror serverMute", async () => {
    const before = (await call(appRouter.auditLog.list, { guildId }, asUser(OWNER))).entries.length;
    await expectCode(
      call(appRouter.mod.disconnectVoice, { guildId, userId: MEMBER }, asUser(MODERATOR)),
      "NOT_FOUND",
    );
    const after = (await call(appRouter.auditLog.list, { guildId }, asUser(OWNER))).entries.length;
    expect(after).toBe(before);

    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(PEER, "dc-p1"));
    await expectCode(
      call(appRouter.mod.disconnectVoice, { guildId, userId: PEER }, asUser(MEMBER)),
      "FORBIDDEN", // no MOVE_MEMBERS
    );
    await expectCode(
      call(appRouter.mod.disconnectVoice, { guildId, userId: PEER }, asUser(MODERATOR)),
      "FORBIDDEN", // equal rank
    );
    await expectCode(
      call(appRouter.mod.disconnectVoice, { guildId, userId: OWNER }, asUser(MODERATOR)),
      "FORBIDDEN", // owner can never be targeted
    );
  });
});
