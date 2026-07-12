import { describe, expect, test } from "vitest";

import type { VoiceRoomOccupancy } from "./occupancy";
import type { RemotePeerMedia } from "./store";
import {
  deriveMiniStage,
  deriveRoomTiles,
  toggleDeafenIntent,
  toggleMuteIntent,
  type VoiceMemberDirectory,
} from "./ui-model";

const G = "guild-1";

const members: VoiceMemberDirectory = new Map([
  ["anna", { name: "Anna", seed: "anna", image: null }],
  ["ben", { name: "Ben", seed: "ben", image: "https://cdn/ben.png" }],
  ["self", { name: "Selma", seed: "selma", image: null }],
]);

function occupancy(overrides?: Partial<VoiceRoomOccupancy>): VoiceRoomOccupancy {
  return {
    guildId: G,
    seats: {
      anna: { selfMute: false, selfDeaf: false },
      ben: { selfMute: true, selfDeaf: false },
    },
    speakingUserIds: [],
    ...overrides,
  };
}

const fakeTrack = () => ({ id: crypto.randomUUID() }) as unknown as MediaStreamTrack;

function remoteMedia(source: "cam" | "screen", track = fakeTrack()): RemotePeerMedia {
  return {
    [source]: { consumerId: `c-${source}`, producerId: `p-${source}`, kind: "video", source, track },
  };
}

const disconnected = {
  members,
  selfUserId: "self",
  connectedHere: false,
  selfMute: false,
  selfDeaf: false,
  localTracks: {},
  peers: {},
};

describe("deriveRoomTiles", () => {
  test("no occupancy → no tiles", () => {
    expect(deriveRoomTiles({ ...disconnected, occupancy: undefined })).toEqual([]);
  });

  test("seats become avatar tiles with member identity and seat flags, sorted by name", () => {
    const tiles = deriveRoomTiles({ ...disconnected, occupancy: occupancy() });
    expect(tiles.map((t) => t.name)).toEqual(["Anna", "Ben"]);
    expect(tiles[0]).toMatchObject({
      userId: "anna",
      isSelf: false,
      seed: "anna",
      image: null,
      selfMute: false,
      selfDeaf: false,
      speaking: false,
      live: false,
      face: { kind: "avatar" },
    });
    expect(tiles[1]).toMatchObject({ userId: "ben", image: "https://cdn/ben.png", selfMute: true });
  });

  test("a seat without a member entry falls back to the userId", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy({ seats: { ghost: { selfMute: false, selfDeaf: false } } }),
    });
    expect(tiles[0]).toMatchObject({ userId: "ghost", name: "ghost", seed: "ghost" });
  });

  test("speaking comes from speakingUserIds", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy({ speakingUserIds: ["ben"] }),
    });
    expect(tiles.find((t) => t.userId === "anna")?.speaking).toBe(false);
    expect(tiles.find((t) => t.userId === "ben")?.speaking).toBe(true);
  });

  test("connected: self is upserted before its seat lands, with store flags", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy(),
      connectedHere: true,
      selfMute: true,
    });
    const self = tiles.find((t) => t.isSelf);
    expect(self).toMatchObject({ userId: "self", name: "Selma", selfMute: true, selfDeaf: false });
    expect(tiles).toHaveLength(3);
  });

  test("connected: store flags win over the seat's flags for self (optimistic mute)", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy({
        seats: { self: { selfMute: false, selfDeaf: false } },
      }),
      connectedHere: true,
      selfMute: true,
      selfDeaf: true,
    });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ isSelf: true, selfMute: true, selfDeaf: true });
  });

  test("remote face priority: screen beats cam, cam beats avatar; LIVE follows screen", () => {
    const both = { ...remoteMedia("screen"), ...remoteMedia("cam") };
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy(),
      connectedHere: true,
      peers: { anna: both, ben: remoteMedia("cam") },
    });
    const anna = tiles.find((t) => t.userId === "anna");
    const ben = tiles.find((t) => t.userId === "ben");
    expect(anna?.face).toMatchObject({ kind: "screen", consumerId: "c-screen" });
    expect(anna?.live).toBe(true);
    expect(ben?.face).toMatchObject({ kind: "cam", consumerId: "c-cam" });
    expect(ben?.live).toBe(false);
  });

  test("self face comes from localTracks with no consumerId", () => {
    const screen = fakeTrack();
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy({ seats: { self: { selfMute: false, selfDeaf: false } } }),
      connectedHere: true,
      localTracks: { mic: fakeTrack(), screen },
    });
    expect(tiles[0]?.face).toEqual({ kind: "screen", track: screen, consumerId: null });
    expect(tiles[0]?.live).toBe(true);
  });

  test("not connected here: media is ignored, faces stay avatars", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy(),
      peers: { anna: remoteMedia("screen") },
      localTracks: { cam: fakeTrack() },
    });
    expect(tiles.every((t) => t.face.kind === "avatar")).toBe(true);
    expect(tiles).toHaveLength(2);
  });
});

describe("deriveMiniStage", () => {
  const tile = (userId: string, over: Record<string, unknown> = {}) => ({
    userId,
    isSelf: false,
    name: userId,
    seed: userId,
    image: null,
    speaking: false,
    selfMute: false,
    selfDeaf: false,
    live: false,
    face: { kind: "avatar" as const },
    ...over,
  });

  test("empty room → null", () => {
    expect(deriveMiniStage([])).toBeNull();
  });

  test("a live screenshare wins the preview", () => {
    const screen = { kind: "screen", track: fakeTrack(), consumerId: "c1" };
    const stage = deriveMiniStage([
      tile("anna", { speaking: true }),
      tile("ben", { live: true, face: screen }),
    ]);
    expect(stage?.preview).toMatchObject({ userId: "ben", face: screen });
    expect(stage?.label).toBe("ben's screen");
  });

  test("no sharer: the active speaker's tile is previewed (cam face carries over)", () => {
    const cam = { kind: "cam", track: fakeTrack(), consumerId: "c2" };
    const stage = deriveMiniStage([tile("anna"), tile("ben", { speaking: true, face: cam })]);
    expect(stage?.preview).toMatchObject({ userId: "ben", face: cam });
    expect(stage?.label).toBe("ben");
  });

  test("silent room: first tile previews; facepile lists everyone in order", () => {
    const stage = deriveMiniStage([tile("anna"), tile("ben")]);
    expect(stage?.preview.userId).toBe("anna");
    expect(stage?.facepile.map((t) => t.userId)).toEqual(["anna", "ben"]);
  });

  test("self preview is labelled You", () => {
    const stage = deriveMiniStage([tile("self", { isSelf: true, speaking: true, name: "Selma" })]);
    expect(stage?.label).toBe("You");
  });

  test("own screenshare is labelled Your screen", () => {
    const screen = { kind: "screen", track: fakeTrack(), consumerId: null };
    const stage = deriveMiniStage([tile("self", { isSelf: true, live: true, face: screen })]);
    expect(stage?.label).toBe("Your screen");
  });
});

describe("mute/deafen intents (prototype semantics)", () => {
  test("mute toggles while not deafened", () => {
    expect(toggleMuteIntent({ selfMute: false, selfDeaf: false })).toEqual({
      selfMute: true,
      selfDeaf: false,
    });
    expect(toggleMuteIntent({ selfMute: true, selfDeaf: false })).toEqual({
      selfMute: false,
      selfDeaf: false,
    });
  });

  test("unmuting while deafened un-deafens too", () => {
    expect(toggleMuteIntent({ selfMute: true, selfDeaf: true })).toEqual({
      selfMute: false,
      selfDeaf: false,
    });
  });

  test("deafening forces mute; un-deafening keeps mute", () => {
    expect(toggleDeafenIntent({ selfMute: false, selfDeaf: false })).toEqual({
      selfMute: true,
      selfDeaf: true,
    });
    expect(toggleDeafenIntent({ selfMute: true, selfDeaf: true })).toEqual({
      selfMute: true,
      selfDeaf: false,
    });
  });
});
