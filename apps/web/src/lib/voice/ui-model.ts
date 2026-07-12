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

export type RoomTileModel = {
  userId: string;
  isSelf: boolean;
  name: string;
  seed: string;
  image: string | null;
  speaking: boolean;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Sharing a screen — the tile grows and carries the LIVE badge. */
  live: boolean;
  face: TileFace;
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

function faceOf(
  remote: RemotePeerMedia | undefined,
  local: Partial<Record<ProducerSource, MediaStreamTrack>> | undefined,
): TileFace {
  if (remote?.screen) {
    return { kind: "screen", track: remote.screen.track, consumerId: remote.screen.consumerId };
  }
  if (local?.screen) return { kind: "screen", track: local.screen, consumerId: null };
  if (remote?.cam) {
    return { kind: "cam", track: remote.cam.track, consumerId: remote.cam.consumerId };
  }
  if (local?.cam) return { kind: "cam", track: local.cam, consumerId: null };
  return { kind: "avatar" };
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
    seats[selfUserId] = { selfMute: input.selfMute, selfDeaf: input.selfDeaf };
  }

  const speaking = new Set(occupancy?.speakingUserIds ?? []);

  const tiles = Object.entries(seats).map(([userId, seat]): RoomTileModel => {
    const isSelf = userId === selfUserId;
    const member = members.get(userId);
    const face = connectedHere
      ? faceOf(input.peers[userId], isSelf ? input.localTracks : undefined)
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
      live: face.kind === "screen",
      face,
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
