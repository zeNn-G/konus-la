import type { VoiceRoomOccupancy } from "./occupancy";
import type { ProducerSource, RemotePeerMedia } from "./store";

/**
 * Pure derivations behind the voice-room UI (#24): occupancy seats + tier-2 media +
 * the guild member cache in, render-ready tile/stage models out. Everything here is
 * plain data so the components stay thin and the logic stays unit-testable.
 */

/** Identity fields the UI needs per user, resolved from the guild member cache. */
export type VoiceMemberInfo = { name: string; seed: string; image: string | null };
export type VoiceMemberDirectory = ReadonlyMap<string, VoiceMemberInfo>;

export type TileFace =
  | { kind: "screen"; track: MediaStreamTrack; consumerId: string | null }
  | { kind: "cam"; track: MediaStreamTrack; consumerId: string | null }
  | { kind: "avatar" };

/** A face that is never a screen — what filmstrip tiles render (screens live on the stage). */
export type PortraitFace = Exclude<TileFace, { kind: "screen" }>;

export type RoomTileModel = {
  userId: string;
  isSelf: boolean;
  name: string;
  seed: string;
  image: string | null;
  speaking: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Moderator-imposed mute (spec §Server-mute) — renders the distinct server-mute badge. */
  serverMuted: boolean;
  /** Sharing a screen — the tile grows and carries the LIVE badge. */
  live: boolean;
  face: TileFace;
  /** Cam > avatar fallback: equals `face` unless a screen won it. */
  camFace: PortraitFace;
};

export type DeriveRoomTilesInput = {
  occupancy: VoiceRoomOccupancy | undefined;
  members: VoiceMemberDirectory;
  selfUserId: string;
  /** True when the live media session is seated in THIS channel — media and the
   *  optimistic self flags only apply then; other rooms render avatar-only previews. */
  connectedHere: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  localTracks: Partial<Record<ProducerSource, MediaStreamTrack>>;
  peers: Record<string, RemotePeerMedia>;
};

function camFaceOf(
  remote: RemotePeerMedia | undefined,
  local: Partial<Record<ProducerSource, MediaStreamTrack>> | undefined,
): PortraitFace {
  if (remote?.cam) {
    return { kind: "cam", track: remote.cam.track, consumerId: remote.cam.consumerId };
  }
  if (local?.cam) return { kind: "cam", track: local.cam, consumerId: null };
  return { kind: "avatar" };
}

function faceOf(
  remote: RemotePeerMedia | undefined,
  local: Partial<Record<ProducerSource, MediaStreamTrack>> | undefined,
  camFace: PortraitFace,
): TileFace {
  if (remote?.screen) {
    return { kind: "screen", track: remote.screen.track, consumerId: remote.screen.consumerId };
  }
  if (local?.screen) return { kind: "screen", track: local.screen, consumerId: null };
  return camFace;
}

/**
 * One tile per seated user. Also feeds the sidebar occupant rows and the mini-stage —
 * they are the same model with the media/face fields simply unused or absent.
 */
export function deriveRoomTiles(input: DeriveRoomTilesInput): RoomTileModel[] {
  const { occupancy, members, selfUserId, connectedHere } = input;

  const seats = { ...occupancy?.seats };
  // While joining, the own voice.peerJoined may not have landed yet — seat self locally
  // so the room never renders without you in it.
  if (connectedHere && !seats[selfUserId]) {
    seats[selfUserId] = { selfMute: input.selfMute, selfDeaf: input.selfDeaf, serverMuted: false };
  }

  const speaking = new Set(occupancy?.speakingUserIds ?? []);

  const tiles = Object.entries(seats).map(([userId, seat]): RoomTileModel => {
    const isSelf = userId === selfUserId;
    const member = members.get(userId);
    const camFace = connectedHere
      ? camFaceOf(input.peers[userId], isSelf ? input.localTracks : undefined)
      : { kind: "avatar" as const };
    const face = connectedHere
      ? faceOf(input.peers[userId], isSelf ? input.localTracks : undefined, camFace)
      : { kind: "avatar" as const };
    return {
      userId,
      isSelf,
      name: member?.name ?? userId,
      seed: member?.seed ?? userId,
      image: member?.image ?? null,
      speaking: speaking.has(userId),
      // Mute/deafen are patched optimistically in the store; prefer them for self so
      // the buttons and the tile never disagree while the server round-trip is in flight.
      selfMute: isSelf && connectedHere ? input.selfMute : seat.selfMute,
      selfDeaf: isSelf && connectedHere ? input.selfDeaf : seat.selfDeaf,
      // Never optimistic: only the server flips it, and the seat patch arrives with it.
      serverMuted: seat.serverMuted,
      live: face.kind === "screen",
      face,
      camFace,
    };
  });

  return tiles.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

export type MiniStageModel = {
  /** The tile shown in the preview area: sharer > active speaker > first occupant. */
  preview: RoomTileModel;
  label: string;
  facepile: RoomTileModel[];
  /** Occupants beyond the facepile cap, rendered as a "+N" chip. */
  facepileOverflow: number;
};

/** The card is w-56; more avatars than this become the "+N" chip. */
const FACEPILE_CAP = 6;

/** The corner card shown on text channels while connected. Null when the room is empty. */
export function deriveMiniStage(tiles: RoomTileModel[]): MiniStageModel | null {
  const preview = tiles.find((t) => t.live) ?? tiles.find((t) => t.speaking) ?? tiles[0];
  if (!preview) return null;
  const name = preview.isSelf ? "You" : preview.name;
  const screenLabel = preview.isSelf ? "Your screen" : `${name}'s screen`;
  return {
    preview,
    label: preview.live ? screenLabel : name,
    facepile: tiles.slice(0, FACEPILE_CAP),
    facepileOverflow: Math.max(0, tiles.length - FACEPILE_CAP),
  };
}

/**
 * Focus reducer for the room stage (#32). Auto-focus only fills a VACANT stage — a later
 * share never steals (the viewer switches by clicking its LIVE tile), and your own share
 * never auto-focuses (it stays click-focusable). A share is a candidate only while
 * "new" — absent from `prevShareUserIds` — so a minimized share cannot re-take the stage,
 * while mounting the room (empty set) treats every live share as new.
 */
export function nextFocus(
  current: string | null,
  prevShareUserIds: ReadonlySet<string>,
  tiles: RoomTileModel[],
): string | null {
  const shares = tiles.filter((t) => t.face.kind === "screen");
  if (current !== null && shares.some((t) => t.userId === current)) return current;
  const fresh = shares.find((t) => !t.isSelf && !prevShareUserIds.has(t.userId));
  return fresh?.userId ?? null;
}

export type StageTileView = {
  tile: RoomTileModel;
  variant: "stage" | "strip";
  /** What this tile renders here: the screen on the stage, `camFace` in the strip. */
  face: TileFace;
};

export type StageLayoutModel = {
  focused: RoomTileModel;
  /** One view per input tile, order preserved (tile identity must survive mode switches). */
  views: StageTileView[];
  /** The focused sharer's own cam as an extra strip entry, when they have one. */
  sharerCam: { tile: RoomTileModel; face: TileFace } | null;
};

/**
 * Focus-mode render model: the focused share fills the stage; every other tile joins the
 * filmstrip showing its `camFace` — a screen face renders on the stage and nowhere else.
 * Null (grid mode) when nothing is focused or the focused user stopped sharing.
 */
export function deriveStageLayout(
  tiles: RoomTileModel[],
  focusedUserId: string | null,
): StageLayoutModel | null {
  if (focusedUserId === null) return null;
  const focused = tiles.find((t) => t.userId === focusedUserId);
  if (!focused || focused.face.kind !== "screen") return null;

  const views = tiles.map(
    (tile): StageTileView =>
      tile === focused
        ? { tile, variant: "stage", face: tile.face }
        : { tile, variant: "strip", face: tile.camFace },
  );
  return {
    focused,
    views,
    sharerCam: focused.camFace.kind === "cam" ? { tile: focused, face: focused.camFace } : null,
  };
}

export type MuteDeafState = { selfMute: boolean; selfDeaf: boolean };

/** Mic button. Unmuting while deafened un-deafens too (decision #10 prototype semantics). */
export function toggleMuteIntent(state: MuteDeafState): MuteDeafState {
  if (state.selfDeaf) return { selfMute: false, selfDeaf: false };
  return { selfMute: !state.selfMute, selfDeaf: false };
}

/** Deafen button. Deafening forces mute; un-deafening leaves the mute in place. */
export function toggleDeafenIntent(state: MuteDeafState): MuteDeafState {
  if (state.selfDeaf) return { selfMute: state.selfMute, selfDeaf: false };
  return { selfMute: true, selfDeaf: true };
}
