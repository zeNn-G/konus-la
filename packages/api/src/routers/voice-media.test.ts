import { createGuildWithOwner } from "@konus-la/db";
import { seedTestMembership, seedTestUser, seedTestVoiceChannel } from "@konus-la/db/testing";
import * as mediasoup from "mediasoup";
import type { types } from "mediasoup";
import { call } from "@orpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { asUser, asWsUser, collect, expectCode, ofType, settle, stopCollectors, waitFor } from "../testing";
import {
  resetVoiceStateForTests,
  updateSpeakingUserIds,
  voiceConnectionClosed,
  voicePeerForTests,
  voiceSnapshotFor,
  voiceWorkerDied,
} from "../voice/rooms";
import { setSfuWorker } from "../voice/sfu";
import { appRouter } from "./index";

/**
 * Media-procedure tests run against a REAL mediasoup worker (vitest runs under Node, so
 * no Bun spawn patch is needed). The client half is hand-crafted: fabricated DTLS
 * fingerprints and minimal rtpParameters — mediasoup accepts them at the API layer, the
 * actual handshake would only matter on the wire.
 *
 * Rate budgets: `voiceSignal` is 15/10 s and `voiceJoin` 10/60 s per user with no reset,
 * so each describe block gets dedicated actors (voice.test.ts precedent).
 */

let worker: types.Worker;

let guildId: string;
let vcA: string;

const OWNER = "vm-owner"; // guild owner; sits in no room — asserts room-only scoping

beforeAll(async () => {
  worker = await mediasoup.createWorker({ logLevel: "error" });
  setSfuWorker(() => worker);

  await seedTestUser({ id: OWNER, username: OWNER });
  guildId = (await createGuildWithOwner({ name: "Media", ownerUserId: OWNER })).id;
  vcA = await seedTestVoiceChannel(guildId, "voice-a");
});

afterAll(() => {
  worker.close();
});

async function seedMember(id: string): Promise<void> {
  await seedTestUser({ id, username: id });
  await seedTestMembership(guildId, id);
}

// --- client-side stand-ins ----------------------------------------------------------------

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

function audioRtpParameters(ssrc: number): types.RtpParameters {
  return {
    mid: String(ssrc),
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
    encodings: [{ ssrc }],
    rtcp: { cname: `cname-${ssrc}` },
  };
}

function videoRtpParameters(ssrc: number): types.RtpParameters {
  return {
    mid: String(ssrc),
    codecs: [{ mimeType: "video/VP8", payloadType: 96, clockRate: 90_000, parameters: {} }],
    headerExtensions: [],
    encodings: [{ ssrc }],
    rtcp: { cname: `cname-${ssrc}` },
  };
}

let nextSsrc = 1000;
const ssrc = () => ++nextSsrc;

/** join → createTransport ×2 → connectTransport ×2 (4 of the 15/10 s signal budget). */
async function ceremony(userId: string, connectionId: string, channelId: string) {
  const ws = asWsUser(userId, connectionId);
  await call(appRouter.voice.join, { channelId }, ws);
  const caps = await call(appRouter.voice.getRouterRtpCapabilities, undefined, ws);
  const send = await call(appRouter.voice.createTransport, { direction: "send" }, ws);
  const recv = await call(appRouter.voice.createTransport, { direction: "recv" }, ws);
  await call(
    appRouter.voice.connectTransport,
    { transportId: send.id, dtlsParameters: FAKE_DTLS },
    ws,
  );
  await call(
    appRouter.voice.connectTransport,
    { transportId: recv.id, dtlsParameters: FAKE_DTLS },
    ws,
  );
  return { ws, caps, send, recv, sendId: send.id, recvId: recv.id };
}

afterEach(() => {
  stopCollectors();
  resetVoiceStateForTests();
});

// --- tests ---------------------------------------------------------------------------------

describe("media transport gate", () => {
  test("media procedures reject non-WS context (fetch /rpc)", async () => {
    await expectCode(
      call(appRouter.voice.getRouterRtpCapabilities, undefined, asUser(OWNER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.voice.createTransport, { direction: "send" }, asUser(OWNER)),
      "FORBIDDEN",
    );
  });
});

describe("peer state machine", () => {
  const USER = "vm-sm";
  beforeAll(() => seedMember(USER));

  test("out-of-order calls are VOICE_INVALID_STATE", async () => {
    const ws = asWsUser(USER, "sm-1");

    // Everything before a seat exists.
    await expectCode(
      call(appRouter.voice.getRouterRtpCapabilities, undefined, ws),
      "VOICE_INVALID_STATE",
    );
    await expectCode(
      call(appRouter.voice.createTransport, { direction: "send" }, ws),
      "VOICE_INVALID_STATE",
    );

    await call(appRouter.voice.join, { channelId: vcA }, ws);

    // connect before create.
    await expectCode(
      call(appRouter.voice.connectTransport, { transportId: "nope", dtlsParameters: FAKE_DTLS }, ws),
      "VOICE_INVALID_STATE",
    );
    // consume before a recv transport exists.
    const caps = await call(appRouter.voice.getRouterRtpCapabilities, undefined, ws);
    await expectCode(
      call(appRouter.voice.consume, { producerId: "nope", rtpCapabilities: caps }, ws),
      "VOICE_INVALID_STATE",
    );

    const send = await call(appRouter.voice.createTransport, { direction: "send" }, ws);
    // produce before connectTransport.
    await expectCode(
      call(
        appRouter.voice.produce,
        { transportId: send.id, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
        ws,
      ),
      "VOICE_INVALID_STATE",
    );

    // duplicate direction.
    await expectCode(
      call(appRouter.voice.createTransport, { direction: "send" }, ws),
      "VOICE_INVALID_STATE",
    );
  });

  test("a stale connection (lost steal) cannot signal for the seat", async () => {
    const stale = asWsUser(USER, "sm-stale");
    await call(appRouter.voice.join, { channelId: vcA }, stale);
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(USER, "sm-winner"));

    await expectCode(
      call(appRouter.voice.createTransport, { direction: "send" }, stale),
      "VOICE_INVALID_STATE",
    );
  });
});

describe("full ceremony, produce & consume", () => {
  const ANNA = "vm-anna";
  const BEN = "vm-ben";
  beforeAll(async () => {
    await seedMember(ANNA);
    await seedMember(BEN);
  });

  test("transports carry ICE/DTLS params; produce announces room-only; consume starts paused", async () => {
    const owner = collect(OWNER); // guild member, NOT in the room
    const anna = await ceremony(ANNA, "fc-a", vcA);
    const ben = await ceremony(BEN, "fc-b", vcA);
    const benEvents = collect(BEN);

    // Transport shape: everything mediasoup-client's device.createSendTransport needs.
    expect(anna.send).toMatchObject({
      id: expect.any(String),
      iceParameters: expect.objectContaining({ usernameFragment: expect.any(String) }),
      iceCandidates: expect.arrayContaining([expect.objectContaining({ ip: expect.any(String) })]),
      dtlsParameters: expect.objectContaining({ fingerprints: expect.any(Array) }),
    });

    const { producerId } = await call(
      appRouter.voice.produce,
      { transportId: anna.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      anna.ws,
    );
    expect(producerId).toEqual(expect.any(String));

    await waitFor(() => ofType(benEvents, "voice.producerAdded").length === 1, "producerAdded");
    expect(ofType(benEvents, "voice.producerAdded")[0]).toMatchObject({
      channelId: vcA,
      userId: ANNA,
      producerId,
      kind: "audio",
      source: "mic",
    });
    // Room-only: the guild owner sits in no room and must hear nothing.
    await settle();
    expect(ofType(owner, "voice.producerAdded")).toHaveLength(0);

    const consumed = await call(
      appRouter.voice.consume,
      { producerId, rtpCapabilities: ben.caps },
      ben.ws,
    );
    expect(consumed).toMatchObject({
      consumerId: expect.any(String),
      producerId,
      kind: "audio",
      rtpParameters: expect.objectContaining({ codecs: expect.any(Array) }),
    });

    // Created server-side paused; batched resume is the single activation verb.
    const benPeer = voicePeerForTests(BEN);
    expect(benPeer?.consumers.get(consumed.consumerId)?.paused).toBe(true);

    await call(
      appRouter.voice.setConsumersPaused,
      { consumerIds: [consumed.consumerId], paused: false },
      ben.ws,
    );
    expect(benPeer?.consumers.get(consumed.consumerId)?.paused).toBe(false);

    // setConsumersPaused broadcasts nothing.
    await settle();
    const total = benEvents.events.length;
    await call(
      appRouter.voice.setConsumersPaused,
      { consumerIds: [consumed.consumerId], paused: true },
      ben.ws,
    );
    await settle();
    expect(benEvents.events.length).toBe(total);
  });

  test("closeProducer publishes producerClosed and frees the source slot", async () => {
    const anna = await ceremony(ANNA, "cp-a", vcA);
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(BEN, "cp-b"));
    const benEvents = collect(BEN);

    const { producerId } = await call(
      appRouter.voice.produce,
      { transportId: anna.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      anna.ws,
    );
    await call(appRouter.voice.closeProducer, { producerId }, anna.ws);

    await waitFor(() => ofType(benEvents, "voice.producerClosed").length === 1, "producerClosed");
    expect(ofType(benEvents, "voice.producerClosed")[0]).toMatchObject({
      channelId: vcA,
      userId: ANNA,
      producerId,
    });

    // The mic slot is free again.
    const again = await call(
      appRouter.voice.produce,
      { transportId: anna.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      anna.ws,
    );
    expect(again.producerId).toEqual(expect.any(String));
  });

  test("consume of an unknown producer is NOT_FOUND; closing someone else's producer too", async () => {
    // Fresh actors: ANNA/BEN's 15/10 s voiceSignal budgets are spent by the tests above.
    const NORA = "vm-nora";
    const OTTO = "vm-otto";
    await seedMember(NORA);
    await seedMember(OTTO);
    const nora = await ceremony(NORA, "nf-n", vcA);
    const otto = await ceremony(OTTO, "nf-o", vcA);

    const { producerId } = await call(
      appRouter.voice.produce,
      { transportId: nora.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      nora.ws,
    );

    await expectCode(
      call(appRouter.voice.consume, { producerId: "missing", rtpCapabilities: otto.caps }, otto.ws),
      "NOT_FOUND",
    );
    await expectCode(call(appRouter.voice.closeProducer, { producerId }, otto.ws), "NOT_FOUND");
  });
});

describe("producer limits (1 mic + ≤1 cam + ≤1 screen)", () => {
  const CARL = "vm-carl";
  beforeAll(() => seedMember(CARL));

  test("duplicate sources rejected, kind/source mismatch rejected", async () => {
    const carl = await ceremony(CARL, "pl-c", vcA);

    const produce = (kind: "audio" | "video", source: "mic" | "cam" | "screen") =>
      call(
        appRouter.voice.produce,
        {
          transportId: carl.sendId,
          kind,
          rtpParameters: kind === "audio" ? audioRtpParameters(ssrc()) : videoRtpParameters(ssrc()),
          source,
        },
        carl.ws,
      );

    await produce("audio", "mic");
    await expectCode(produce("audio", "mic"), "VOICE_INVALID_STATE");
    await produce("video", "cam");
    await expectCode(produce("video", "cam"), "VOICE_INVALID_STATE");
    await produce("video", "screen");
    await expectCode(produce("video", "screen"), "VOICE_INVALID_STATE");

    // kind/source pairing is a schema-level contract.
    await expectCode(produce("video", "mic"), "BAD_REQUEST");
    await expectCode(produce("audio", "cam"), "BAD_REQUEST");
  });

  test("interleaved produces for one source: exactly one wins the slot", async () => {
    const PETE = "vm-pete";
    await seedMember(PETE);
    const pete = await ceremony(PETE, "rc-p", vcA);

    const mic = () =>
      call(
        appRouter.voice.produce,
        { transportId: pete.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
        pete.ws,
      );
    const results = await Promise.allSettled([mic(), mic()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected");
    expect((loser as PromiseRejectedResult).reason.code).toBe("VOICE_INVALID_STATE");
  });
});

describe("deafen server half", () => {
  const DORA = "vm-dora";
  const EMIL = "vm-emil";
  beforeAll(async () => {
    await seedMember(DORA);
    await seedMember(EMIL);
  });

  test("setSelfDeaf pauses audio consumers only; undeafen resumes them", async () => {
    const dora = await ceremony(DORA, "df-d", vcA);
    const emil = await ceremony(EMIL, "df-e", vcA);

    const mic = await call(
      appRouter.voice.produce,
      { transportId: dora.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      dora.ws,
    );
    const cam = await call(
      appRouter.voice.produce,
      { transportId: dora.sendId, kind: "video", rtpParameters: videoRtpParameters(ssrc()), source: "cam" },
      dora.ws,
    );

    const audio = await call(
      appRouter.voice.consume,
      { producerId: mic.producerId, rtpCapabilities: emil.caps },
      emil.ws,
    );
    const video = await call(
      appRouter.voice.consume,
      { producerId: cam.producerId, rtpCapabilities: emil.caps },
      emil.ws,
    );
    await call(
      appRouter.voice.setConsumersPaused,
      { consumerIds: [audio.consumerId, video.consumerId], paused: false },
      emil.ws,
    );

    const peer = voicePeerForTests(EMIL);
    await call(appRouter.voice.setSelfDeaf, { deafened: true }, emil.ws);
    expect(peer?.consumers.get(audio.consumerId)?.paused).toBe(true);
    expect(peer?.consumers.get(video.consumerId)?.paused).toBe(false); // video untouched

    // While deafened, a (buggy/racing) client resume must not undo the server pause.
    await call(
      appRouter.voice.setConsumersPaused,
      { consumerIds: [audio.consumerId], paused: false },
      emil.ws,
    );
    expect(peer?.consumers.get(audio.consumerId)?.paused).toBe(true);

    await call(appRouter.voice.setSelfDeaf, { deafened: false }, emil.ws);
    expect(peer?.consumers.get(audio.consumerId)?.paused).toBe(false);
  });
});

describe("consumer ownership", () => {
  const FAY = "vm-fay";
  const GUS = "vm-gus";
  beforeAll(async () => {
    await seedMember(FAY);
    await seedMember(GUS);
  });

  test("setConsumersPaused only ever touches the caller's own consumers", async () => {
    const fay = await ceremony(FAY, "ow-f", vcA);
    const gus = await ceremony(GUS, "ow-g", vcA);

    const { producerId } = await call(
      appRouter.voice.produce,
      { transportId: fay.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      fay.ws,
    );
    const consumed = await call(
      appRouter.voice.consume,
      { producerId, rtpCapabilities: gus.caps },
      gus.ws,
    );
    await call(
      appRouter.voice.setConsumersPaused,
      { consumerIds: [consumed.consumerId], paused: false },
      gus.ws,
    );

    // FAY names GUS's consumer id: skipped (not hers), GUS's consumer untouched.
    await call(
      appRouter.voice.setConsumersPaused,
      { consumerIds: [consumed.consumerId], paused: true },
      fay.ws,
    );
    expect(voicePeerForTests(GUS)?.consumers.get(consumed.consumerId)?.paused).toBe(false);
  });
});

describe("media teardown", () => {
  const HANS = "vm-hans";
  const IRIS = "vm-iris";
  beforeAll(async () => {
    await seedMember(HANS);
    await seedMember(IRIS);
  });

  test("socket drop closes media and announces producerClosed room-only; seat survives", async () => {
    const hans = await ceremony(HANS, "td-h", vcA);
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(IRIS, "td-i"));
    const iris = collect(IRIS);

    const { producerId } = await call(
      appRouter.voice.produce,
      { transportId: hans.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      hans.ws,
    );

    voiceConnectionClosed("td-h"); // default 30 s grace — seat stays for the whole test
    await waitFor(() => ofType(iris, "voice.producerClosed").length === 1, "producerClosed");
    expect(ofType(iris, "voice.producerClosed")[0]).toMatchObject({
      channelId: vcA,
      userId: HANS,
      producerId,
    });
    expect(voicePeerForTests(HANS)).toBeNull(); // media half gone
    expect(await voiceSnapshotFor(OWNER)).toEqual([
      expect.objectContaining({
        channelId: vcA,
        seats: expect.arrayContaining([expect.objectContaining({ userId: HANS })]),
      }),
    ]);
  });

  test("worker death discards handles silently; rejoin rebuilds the router lazily", async () => {
    const hans = await ceremony(HANS, "wd-h", vcA);
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(IRIS, "wd-i"));
    const iris = collect(IRIS);

    await call(
      appRouter.voice.produce,
      { transportId: hans.sendId, kind: "audio", rtpParameters: audioRtpParameters(ssrc()), source: "mic" },
      hans.ws,
    );

    voiceWorkerDied(60_000);
    await settle();
    // Silent: mediaReset (worker respawn) is the recovery signal, not producer churn.
    expect(ofType(iris, "voice.producerClosed")).toHaveLength(0);
    expect(voicePeerForTests(HANS)).toBeNull();

    // The rejoin (grace rebind) rebuilds router + observer through the lazy-creation path.
    const ws = asWsUser(HANS, "wd-h2");
    await call(appRouter.voice.join, { channelId: vcA }, ws);
    const caps = await call(appRouter.voice.getRouterRtpCapabilities, undefined, ws);
    expect(caps).toMatchObject({ codecs: expect.any(Array) });
  });
});

describe("active speakers (edge-triggered full set)", () => {
  const JIM = "vm-jim";
  const KAY = "vm-kay";
  beforeAll(async () => {
    await seedMember(JIM);
    await seedMember(KAY);
  });

  test("publishes guild-wide only when the set changes; snapshot carries it", async () => {
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(JIM, "as-j"));
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(KAY, "as-k"));
    const owner = collect(OWNER); // guild-wide: even non-room members see rings

    updateSpeakingUserIds(vcA, [JIM]);
    await waitFor(() => ofType(owner, "voice.activeSpeakers").length === 1, "first set");
    expect(ofType(owner, "voice.activeSpeakers")[0]).toMatchObject({
      guildId,
      channelId: vcA,
      speakingUserIds: [JIM],
    });

    updateSpeakingUserIds(vcA, [JIM]); // same set — the edge trigger must swallow it
    await settle();
    expect(ofType(owner, "voice.activeSpeakers")).toHaveLength(1);

    expect(await voiceSnapshotFor(OWNER)).toEqual([
      expect.objectContaining({ channelId: vcA, speakingUserIds: [JIM] }),
    ]);

    updateSpeakingUserIds(vcA, [JIM, KAY]);
    await waitFor(() => ofType(owner, "voice.activeSpeakers").length === 2, "grown set");

    updateSpeakingUserIds(vcA, []); // silence
    await waitFor(() => ofType(owner, "voice.activeSpeakers").length === 3, "silence");
    expect(ofType(owner, "voice.activeSpeakers")[2]!.speakingUserIds).toEqual([]);
  });

  test("a leaving speaker falls out of the published set", async () => {
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(JIM, "ls-j"));
    await call(appRouter.voice.join, { channelId: vcA }, asWsUser(KAY, "ls-k"));
    updateSpeakingUserIds(vcA, [JIM, KAY]);
    const owner = collect(OWNER);

    await call(appRouter.voice.leave, undefined, asWsUser(JIM, "ls-j"));
    // The pre-leave [JIM, KAY] publish may land after the subscription too — wait for the
    // corrected set itself, then confirm it is the LAST word.
    await waitFor(
      () => ofType(owner, "voice.activeSpeakers").some((e) => e.speakingUserIds.length === 1),
      "corrected set",
    );
    expect(ofType(owner, "voice.activeSpeakers").at(-1)!.speakingUserIds).toEqual([KAY]);
  });
});

describe("media rate limits", () => {
  const LEO = "vm-leo";
  const MIA = "vm-mia";
  beforeAll(async () => {
    await seedMember(LEO);
    await seedMember(MIA);
  });

  test("voiceSignal: 15 per 10 s across the ceremony procedures", async () => {
    const ws = asWsUser(LEO, "rl-l");
    await call(appRouter.voice.join, { channelId: vcA }, ws);
    for (let i = 0; i < 15; i++) {
      // Failed calls spend budget too — only the 16th may be TOO_MANY_REQUESTS.
      await call(appRouter.voice.createTransport, { direction: "send" }, ws).catch(() => {});
    }
    await expectCode(
      call(appRouter.voice.createTransport, { direction: "recv" }, ws),
      "TOO_MANY_REQUESTS",
    );
  });

  test("voiceConsume: consume and setConsumersPaused share 60 per 10 s", async () => {
    const ws = asWsUser(MIA, "rl-m");
    await call(appRouter.voice.join, { channelId: vcA }, ws);
    for (let i = 0; i < 60; i++) {
      // Unknown ids are skipped (closed-consumer races are normal), so these all succeed.
      await call(appRouter.voice.setConsumersPaused, { consumerIds: ["gone"], paused: true }, ws);
    }
    await expectCode(
      call(appRouter.voice.setConsumersPaused, { consumerIds: ["gone"], paused: true }, ws),
      "TOO_MANY_REQUESTS",
    );
  });
});
