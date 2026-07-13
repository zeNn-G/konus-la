import { describe, expect, test } from "vitest";

import { reduceVoiceOccupancy, type VoiceOccupancyMap } from "./occupancy";

const G = "guild-1";
const VC = "vc-1";

const seeded: VoiceOccupancyMap = {
  [VC]: {
    guildId: G,
    seats: { anna: { selfMute: false, selfDeaf: false } },
    speakingUserIds: ["anna"],
  },
};

describe("reduceVoiceOccupancy", () => {
  test("snapshot replaces the whole map (stale rooms drop)", () => {
    const next = reduceVoiceOccupancy(seeded, {
      type: "voice.snapshot",
      rooms: [
        {
          guildId: G,
          channelId: "vc-2",
          seats: [{ userId: "ben", selfMute: true, selfDeaf: false }],
          speakingUserIds: [],
        },
      ],
    });
    expect(next).toEqual({
      "vc-2": {
        guildId: G,
        seats: { ben: { selfMute: true, selfDeaf: false } },
        speakingUserIds: [],
      },
    });
  });

  test("peerJoined creates the room lazily and adds the seat", () => {
    const next = reduceVoiceOccupancy(undefined, {
      type: "voice.peerJoined",
      guildId: G,
      channelId: VC,
      userId: "anna",
      selfMute: false,
      selfDeaf: true,
    });
    expect(next[VC]).toEqual({
      guildId: G,
      seats: { anna: { selfMute: false, selfDeaf: true } },
      speakingUserIds: [],
    });
  });

  test("peerLeft drops the seat and the speaking ring; the last seat GCs the room", () => {
    const twoSeats = reduceVoiceOccupancy(seeded, {
      type: "voice.peerJoined",
      guildId: G,
      channelId: VC,
      userId: "ben",
      selfMute: false,
      selfDeaf: false,
    });
    const afterAnna = reduceVoiceOccupancy(twoSeats, {
      type: "voice.peerLeft",
      guildId: G,
      channelId: VC,
      userId: "anna",
    });
    expect(afterAnna[VC]).toEqual({
      guildId: G,
      seats: { ben: { selfMute: false, selfDeaf: false } },
      speakingUserIds: [],
    });
    const empty = reduceVoiceOccupancy(afterAnna, {
      type: "voice.peerLeft",
      guildId: G,
      channelId: VC,
      userId: "ben",
    });
    expect(empty[VC]).toBeUndefined();
  });

  test("flag events patch the seat in place", () => {
    const muted = reduceVoiceOccupancy(seeded, {
      type: "voice.peerMutedSelf",
      guildId: G,
      channelId: VC,
      userId: "anna",
      selfMute: true,
    });
    expect(muted[VC]?.seats.anna).toEqual({ selfMute: true, selfDeaf: false });
    const deafened = reduceVoiceOccupancy(muted, {
      type: "voice.peerDeafenedSelf",
      guildId: G,
      channelId: VC,
      userId: "anna",
      selfDeaf: true,
    });
    expect(deafened[VC]?.seats.anna).toEqual({ selfMute: true, selfDeaf: true });
  });

  test("activeSpeakers replaces the room's set wholesale", () => {
    const next = reduceVoiceOccupancy(seeded, {
      type: "voice.activeSpeakers",
      guildId: G,
      channelId: VC,
      speakingUserIds: ["ben", "cara"],
    });
    expect(next[VC]?.speakingUserIds).toEqual(["ben", "cara"]);
  });

  test("channel.deleted drops the whole room", () => {
    const next = reduceVoiceOccupancy(seeded, {
      type: "channel.deleted",
      guildId: G,
      channelId: VC,
    });
    expect(next[VC]).toBeUndefined();
  });

  test("channel.deleted for a channel with no room (a text channel) is a no-op", () => {
    const next = reduceVoiceOccupancy(seeded, {
      type: "channel.deleted",
      guildId: G,
      channelId: "text-channel-1",
    });
    expect(next).toBe(seeded);
  });

  test("events for unknown rooms or seats are no-ops (not crashes)", () => {
    expect(
      reduceVoiceOccupancy(undefined, {
        type: "voice.peerLeft",
        guildId: G,
        channelId: VC,
        userId: "ghost",
      }),
    ).toEqual({});
    expect(
      reduceVoiceOccupancy(seeded, {
        type: "voice.peerMutedSelf",
        guildId: G,
        channelId: VC,
        userId: "ghost",
        selfMute: true,
      }),
    ).toEqual(seeded);
    expect(
      reduceVoiceOccupancy(undefined, {
        type: "voice.activeSpeakers",
        guildId: G,
        channelId: "vc-unknown",
        speakingUserIds: ["anna"],
      }),
    ).toEqual({});
  });
});
