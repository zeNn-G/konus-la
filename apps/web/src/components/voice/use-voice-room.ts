import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { playSoundCue } from "@/lib/sound-effects";
import { useVoiceOccupancy } from "@/lib/voice/occupancy";
import { voiceSession } from "@/lib/voice/session";
import { useVoiceStore, type ScreensharePreset } from "@/lib/voice/store";
import {
  deriveRoomTiles,
  muteDeafCue,
  nextFocus,
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

export type StageFocus = {
  /** UserId whose share fills the stage; null renders the plain grid. */
  focusedUserId: string | null;
  focus: (userId: string) => void;
  minimize: () => void;
};

/**
 * Which share owns the room stage (#32). Plain component state — nothing persists across
 * navigation — advanced by the `nextFocus` reducer: peer shares auto-focus onto a vacant
 * stage only, own shares and already-seen (minimized) shares never do.
 */
export function useStageFocus(tiles: RoomTileModel[], connectedHere: boolean): StageFocus {
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const prevShareUserIds = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!connectedHere) {
      prevShareUserIds.current = new Set();
      setFocusedUserId(null);
      return;
    }
    // Snapshot before updating the ref: the state updater runs lazily on the NEXT render,
    // by which time `.current` already contains this round's shares — reading the ref
    // inside the updater would make every share look already-seen and kill auto-focus.
    const prev = prevShareUserIds.current;
    prevShareUserIds.current = new Set(
      tiles.filter((t) => t.face.kind === "screen").map((t) => t.userId),
    );
    setFocusedUserId((current) => nextFocus(current, prev, tiles));
  }, [tiles, connectedHere]);

  return {
    focusedUserId: connectedHere ? focusedUserId : null,
    focus: setFocusedUserId,
    minimize: () => setFocusedUserId(null),
  };
}

export type StageFullscreen = {
  /** Attach to the stage tile container — the fullscreen target. */
  ref: (node: HTMLDivElement | null) => void;
  fullscreen: boolean;
  toggle: () => void;
};

/**
 * Browser fullscreen for the stage container. State follows the `fullscreenchange` event
 * only — Esc exits natively and the app must never disagree with the browser. When the
 * stage moves to another element or unmounts while fullscreen (focus switch, share end),
 * fullscreen is released explicitly: the old element usually STAYS in the DOM as a grid
 * tile, so the browser won't auto-exit for us.
 */
export function useStageFullscreen(): StageFullscreen {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement !== null &&
        document.fullscreenElement === elementRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Identity-stable: an inline callback would re-run (null → node) every render and
  // release fullscreen on unrelated re-renders (speaking rings, occupancy churn).
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (elementRef.current !== node && document.fullscreenElement === elementRef.current) {
      void document.exitFullscreen().catch(() => {});
    }
    elementRef.current = node;
  }, []);

  return {
    ref,
    fullscreen,
    toggle: () => {
      if (document.fullscreenElement === elementRef.current && elementRef.current) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void elementRef.current?.requestFullscreen().catch(() => {});
      }
    },
  };
}

export type VoiceControls = {
  selfMute: boolean;
  selfDeaf: boolean;
  micError: boolean;
  /** Moderator-imposed (spec §Server-mute): the mic button locks; only a mod unlocks it. */
  serverMuted: boolean;
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
  const { session } = appRoute.useRouteContext();
  const selfMute = useVoiceStore((s) => s.selfMute);
  const selfDeaf = useVoiceStore((s) => s.selfDeaf);
  const micError = useVoiceStore((s) => s.micError);
  // The lock reads the own seat off tier-1 occupancy — snapshot, peerJoined, and
  // serverMuteSet all keep it current, so a muted user re-joining locks immediately.
  const sessionChannelId = useVoiceStore((s) => s.channelId);
  const occupancy = useVoiceOccupancy(sessionChannelId ?? "");
  const serverMuted = occupancy?.seats[session.user.id]?.serverMuted ?? false;
  const sharing = useVoiceStore((s) => s.localTracks.screen !== undefined);
  const camOn = useVoiceStore((s) => s.localTracks.cam !== undefined);
  // Optimistic "starting" (#25): the button lights on the click and reverts if capture
  // is denied/cancelled. Local to this hook instance — the clicked surface shows it.
  const [camPending, setCamPending] = useState(false);
  const [sharePending, setSharePending] = useState(false);

  const apply = (next: MuteDeafState) => {
    // One click, one cue (#79): the intent transition decides which sound plays even
    // when it moves both flags (deafen forces mute) — the session setters stay silent.
    const cue = muteDeafCue({ selfMute, selfDeaf }, next);
    if (cue) playSoundCue(cue);
    if (next.selfMute !== selfMute) void voiceSession.setSelfMute(next.selfMute);
    if (next.selfDeaf !== selfDeaf) void voiceSession.setSelfDeaf(next.selfDeaf);
  };

  return {
    selfMute,
    selfDeaf,
    micError,
    serverMuted,
    sharing: sharing || sharePending,
    camOn: camOn || camPending,
    toggleMute: () => {
      if (serverMuted) return; // locked — only mod.serverMute(false) releases it
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
