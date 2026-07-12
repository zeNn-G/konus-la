import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";

import { useVoiceOccupancy } from "@/lib/voice/occupancy";
import { voiceSession } from "@/lib/voice/session";
import { useVoiceStore } from "@/lib/voice/store";
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
  toggleShare: () => void;
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

  const apply = (next: MuteDeafState) => {
    if (next.selfMute !== selfMute) void voiceSession.setSelfMute(next.selfMute);
    if (next.selfDeaf !== selfDeaf) void voiceSession.setSelfDeaf(next.selfDeaf);
  };

  return {
    selfMute,
    selfDeaf,
    micError,
    sharing,
    camOn,
    toggleMute: () => {
      // Listen-only join: the mic button IS the retry (spec §UX). Toast copy lands with #25.
      if (micError) {
        void voiceSession.retryMic();
        return;
      }
      apply(toggleMuteIntent({ selfMute, selfDeaf }));
    },
    toggleDeafen: () => apply(toggleDeafenIntent({ selfMute, selfDeaf })),
    // Capture rejections (permission denied / picker cancel) leave the state untouched, so
    // the button simply stays off; the denial toast UX is issue #25.
    toggleShare: () => {
      void (sharing ? voiceSession.stopScreenshare() : voiceSession.startScreenshare()).catch(
        () => {},
      );
    },
    toggleCam: () => {
      void (camOn ? voiceSession.disableCam() : voiceSession.enableCam()).catch(() => {});
    },
    disconnect: () => void voiceSession.leave(),
  };
}
