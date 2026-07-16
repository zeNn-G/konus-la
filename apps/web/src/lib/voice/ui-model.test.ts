import { describe, expect, test } from "vitest";

import type { VoiceRoomOccupancy } from "./occupancy";
import type { RemotePeerMedia } from "./store";
import {
  deriveMiniStage,
  deriveRoomTiles,
  deriveStageLayout,
  nextFocus,
  toggleDeafenIntent,
  toggleMuteIntent,
  type RoomTileModel,
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
      anna: { selfMute: false, selfDeaf: false, serverMuted: false },
      ben: { selfMute: true, selfDeaf: false, serverMuted: false },
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
      occupancy: occupancy({ seats: { ghost: { selfMute: false, selfDeaf: false, serverMuted: false } } }),
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
        seats: { self: { selfMute: false, selfDeaf: false, serverMuted: false } },
      }),
      connectedHere: true,
      selfMute: true,
      selfDeaf: true,
    });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ isSelf: true, selfMute: true, selfDeaf: true });
  });

  test("serverMuted flows from the seat to the tile; the pre-seat self upsert defaults it off", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy({
        seats: { anna: { selfMute: false, selfDeaf: false, serverMuted: true } },
      }),
      connectedHere: true,
    });
    expect(tiles.find((t) => t.userId === "anna")?.serverMuted).toBe(true);
    expect(tiles.find((t) => t.isSelf)?.serverMuted).toBe(false);
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
      occupancy: occupancy({ seats: { self: { selfMute: false, selfDeaf: false, serverMuted: false } } }),
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
    serverMuted: false,
    live: false,
    face: { kind: "avatar" as const },
    camFace: { kind: "avatar" as const },
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
    expect(stage?.facepileOverflow).toBe(0);
  });

  test("a crowded room caps the facepile and reports the overflow", () => {
    const stage = deriveMiniStage(Array.from({ length: 9 }, (_, i) => tile(`user-${i}`)));
    expect(stage?.facepile).toHaveLength(6);
    expect(stage?.facepileOverflow).toBe(3);
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

describe("camFace (deriveRoomTiles)", () => {
  test("a sharer with a cam keeps the cam as camFace while the screen wins the face", () => {
    const both = { ...remoteMedia("screen"), ...remoteMedia("cam") };
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy(),
      connectedHere: true,
      peers: { anna: both },
    });
    const anna = tiles.find((t) => t.userId === "anna");
    expect(anna?.face).toMatchObject({ kind: "screen" });
    expect(anna?.camFace).toMatchObject({ kind: "cam", consumerId: "c-cam" });
  });

  test("a sharer without a cam falls back to an avatar camFace", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy(),
      connectedHere: true,
      peers: { anna: remoteMedia("screen") },
    });
    expect(tiles.find((t) => t.userId === "anna")?.camFace).toEqual({ kind: "avatar" });
  });

  test("non-sharers get camFace equal to their face", () => {
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy(),
      connectedHere: true,
      peers: { anna: remoteMedia("cam") },
    });
    const anna = tiles.find((t) => t.userId === "anna");
    const ben = tiles.find((t) => t.userId === "ben");
    expect(anna?.camFace).toEqual(anna?.face);
    expect(ben?.camFace).toEqual({ kind: "avatar" });
  });

  test("own local screen + cam: camFace is the local cam with no consumerId", () => {
    const cam = fakeTrack();
    const tiles = deriveRoomTiles({
      ...disconnected,
      occupancy: occupancy({ seats: { self: { selfMute: false, selfDeaf: false, serverMuted: false } } }),
      connectedHere: true,
      localTracks: { screen: fakeTrack(), cam },
    });
    expect(tiles[0]?.face).toMatchObject({ kind: "screen" });
    expect(tiles[0]?.camFace).toEqual({ kind: "cam", track: cam, consumerId: null });
  });
});

const stageTile = (userId: string, over: Partial<RoomTileModel> = {}): RoomTileModel => ({
  userId,
  isSelf: false,
  name: userId,
  seed: userId,
  image: null,
  speaking: false,
  selfMute: false,
  selfDeaf: false,
  serverMuted: false,
  live: false,
  face: { kind: "avatar" },
  camFace: { kind: "avatar" },
  ...over,
});

const sharerTile = (userId: string, over: Partial<RoomTileModel> = {}): RoomTileModel =>
  stageTile(userId, {
    live: true,
    face: { kind: "screen", track: fakeTrack(), consumerId: `c-${userId}` },
    ...over,
  });

describe("nextFocus", () => {
  const none = new Set<string>();

  test("vacant stage: a peer share auto-focuses (mount counts — all shares are new)", () => {
    expect(nextFocus(null, none, [stageTile("anna"), sharerTile("ben")])).toBe("ben");
  });

  test("two peer shares on a vacant stage: first in tile order wins", () => {
    expect(nextFocus(null, none, [sharerTile("anna"), sharerTile("ben")])).toBe("anna");
  });

  test("no steal: a new share never replaces the focused one", () => {
    expect(nextFocus("anna", new Set(["anna"]), [sharerTile("anna"), sharerTile("ben")])).toBe(
      "anna",
    );
  });

  test("own share never auto-focuses", () => {
    expect(nextFocus(null, none, [sharerTile("self", { isSelf: true })])).toBeNull();
  });

  test("a manually focused own share stays focused", () => {
    expect(nextFocus("self", new Set(["self"]), [sharerTile("self", { isSelf: true })])).toBe(
      "self",
    );
  });

  test("focused share ended → back to null (an already-known share does not take over)", () => {
    expect(nextFocus("anna", new Set(["anna", "ben"]), [stageTile("anna"), sharerTile("ben")]))
      .toBeNull();
  });

  test("after a minimize the same share does not re-focus", () => {
    expect(nextFocus(null, new Set(["anna"]), [sharerTile("anna")])).toBeNull();
  });

  test("after a minimize a brand-new share auto-focuses onto the vacant stage", () => {
    expect(nextFocus(null, new Set(["anna"]), [sharerTile("anna"), sharerTile("ben")])).toBe(
      "ben",
    );
  });

  test("a restarted share counts as new again", () => {
    expect(nextFocus(null, new Set(["anna"]), [sharerTile("anna")])).toBeNull();
    expect(nextFocus(null, none, [sharerTile("anna")])).toBe("anna");
  });
});

describe("deriveStageLayout", () => {
  test("null without a focused user or when the focused user is not sharing", () => {
    expect(deriveStageLayout([sharerTile("anna")], null)).toBeNull();
    expect(deriveStageLayout([stageTile("anna")], "anna")).toBeNull();
    expect(deriveStageLayout([sharerTile("anna")], "ghost")).toBeNull();
  });

  test("focused tile keeps its screen face on the stage; input order is preserved", () => {
    const anna = sharerTile("anna");
    const layout = deriveStageLayout([stageTile("_zed"), anna, stageTile("ben")], "anna");
    expect(layout?.focused).toBe(anna);
    expect(layout?.views.map((v) => v.tile.userId)).toEqual(["_zed", "anna", "ben"]);
    expect(layout?.views[1]).toMatchObject({ variant: "stage", face: { kind: "screen" } });
    expect(layout?.views[0]).toMatchObject({ variant: "strip" });
  });

  test("strip faces are never screens: other sharers collapse to their camFace, LIVE kept", () => {
    const cam = { kind: "cam" as const, track: fakeTrack(), consumerId: "c-ben-cam" };
    const layout = deriveStageLayout(
      [sharerTile("anna"), sharerTile("ben", { camFace: cam })],
      "anna",
    );
    const ben = layout?.views[1];
    expect(ben?.face).toBe(cam);
    expect(ben?.tile.live).toBe(true);
    expect(layout?.views.every((v) => v.variant === "stage" || v.face.kind !== "screen")).toBe(
      true,
    );
  });

  test("the focused sharer's cam appears as an extra strip entry", () => {
    const cam = { kind: "cam" as const, track: fakeTrack(), consumerId: "c-anna-cam" };
    const layout = deriveStageLayout([sharerTile("anna", { camFace: cam })], "anna");
    expect(layout?.sharerCam).toMatchObject({ tile: { userId: "anna" }, face: cam });
  });

  test("no extra strip entry when the focused sharer has no cam", () => {
    const layout = deriveStageLayout([sharerTile("anna")], "anna");
    expect(layout?.sharerCam).toBeNull();
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
