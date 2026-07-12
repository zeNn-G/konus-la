import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useVoiceOccupancy } from "@/lib/voice/occupancy";
import { voiceSession } from "@/lib/voice/session";
import { useVoiceStore, type ScreensharePreset } from "@/lib/voice/store";
import {
  deriveRoomTiles,
  toggleDeafenIntent,
  toggleMuteIntent,
  type MuteDeafState,
  type RoomTileModel,
  type VoiceMemberDirectory,
  type VoiceMemberInfo,
} from "@/lib/voice/ui-model";
import { orpc } from "@/utils/orpc";

const appRoute = getRouteApi("/(app)");

/** Name of a channel in the connected guild — the deck header and mini-stage caption. */
export function useVoiceChannelName(guildId: string | null, channelId: string | null): string {
  const channels = useQuery({
    ...orpc.channel.list.queryOptions({ input: { guildId: guildId ?? "" } }),
    enabled: guildId !== null,
  });
  return channels.data?.find((c) => c.id === channelId)?.name ?? "";
}

/** Guild members as the identity directory the voice tiles/rows resolve userIds against. */
export function useVoiceMembers(guildId: string | null): VoiceMemberDirectory {
  const guild = useQuery({
    ...orpc.guild.get.queryOptions({ input: { guildId: guildId ?? "" } }),
    enabled: guildId !== null,
  });
  const members = guild.data?.members;
  return useMemo(() => {
    const directory = new Map<string, VoiceMemberInfo>();
    for (const member of members ?? []) {
      directory.set(member.userId, {
        name: member.displayName || member.username || member.userId,
        seed: member.username ?? member.userId,
        image: member.image ?? null,
      });
    }
    return directory;
  }, [members]);
}

/** Render-ready tiles for one voice channel, plus whether the live session sits in it. */
export function useRoomTiles(
  guildId: string | null,
  channelId: string | null,
): { tiles: RoomTileModel[]; connectedHere: boolean } {
  const { session } = appRoute.useRouteContext();
  const selfUserId = session.user.id;

  const occupancy = useVoiceOccupancy(channelId ?? "");
  const members = useVoiceMembers(guildId);
  const status = useVoiceStore((s) => s.status);
  const sessionChannelId = useVoiceStore((s) => s.channelId);
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const localTracks = useVoiceStore((s) => s.localTracks);
  const peers = useVoiceStore((s) => s.peers);

  const connectedHere =
    status !== "idle" && channelId !== null && sessionChannelId === channelId;

  const tiles = useMemo(
    () =>
      deriveRoomTiles({
        occupancy,
        members,
        selfUserId,
        connectedHere,
        selfMute,
        selfDeaf,
        localTracks,
        peers,
      }),
    [occupancy, members, selfUserId, connectedHere, selfMute, selfDeaf, localTracks, peers],
  );

  return { tiles, connectedHere };
}

export type VoiceControls = {
  selfMute: boolean;
  selfDeaf: boolean;
  micError: boolean;
  sharing: boolean;
  camOn: boolean;
  toggleMute: () => void;
  toggleDeafen: () => void;
  /** Preset chosen in the quality popover BEFORE `getDisplayMedia` (spec §Media policy). */
  startShare: (preset: ScreensharePreset) => void;
  stopShare: () => void;
  toggleCam: () => void;
  disconnect: () => void;
};

/** The five session controls shared by the room capsule and the sidebar deck. */
export function useVoiceControls(): VoiceControls {
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const micError = useVoiceStore((s) => s.micError);
  const sharing = useVoiceStore((s) => s.localTracks.screen !== undefined);
  const camOn = useVoiceStore((s) => s.localTracks.cam !== undefined);
  // Optimistic "starting" (#25): the button lights on the click and reverts if capture
  // is denied/cancelled. Local to this hook instance — the clicked surface shows it.
  const [camPending, setCamPending] = useState(false);
  const [sharePending, setSharePending] = useState(false);

  const apply = (next: MuteDeafState) => {
    if (next.selfMute !== selfMute) void voiceSession.setSelfMute(next.selfMute);
    if (next.selfDeaf !== selfDeaf) void voiceSession.setSelfDeaf(next.selfDeaf);
  };

  return {
    selfMute,
    selfDeaf,
    micError,
    sharing: sharing || sharePending,
    camOn: camOn || camPending,
    toggleMute: () => {
      // Listen-only join: the mic button IS the retry; a failed retry is a repeat
      // denial and gets the check-browser-permissions toast (spec §UX).
      if (micError) {
        void voiceSession.retryMic().then((result) => {
          if (result === "denied") {
            toast.error("Mic is blocked — allow microphone access in your browser");
          }
        });
        return;
      }
      apply(toggleMuteIntent({ selfMute, selfDeaf }));
    },
    toggleDeafen: () => apply(toggleDeafenIntent({ selfMute, selfDeaf })),
    startShare: (preset) => {
      if (sharing || sharePending) return;
      setSharePending(true);
      voiceSession
        .startScreenshare(preset)
        // Silent revert (spec §UX): the OS picker self-explains, and Chrome reports a
        // user-cancel as NotAllowedError — a toast would just nag.
        .catch(() => {})
        .finally(() => setSharePending(false));
    },
    stopShare: () => void voiceSession.stopScreenshare(),
    toggleCam: () => {
      if (camOn) {
        void voiceSession.disableCam();
        return;
      }
      if (camPending) return;
      setCamPending(true);
      voiceSession
        .enableCam()
        .catch(() => toast.error("Couldn't start your camera — check browser permissions"))
        .finally(() => setCamPending(false));
    },
    disconnect: () => void voiceSession.leave(),
  };
}
