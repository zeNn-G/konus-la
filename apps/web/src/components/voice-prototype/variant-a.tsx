// VOICE UX PROTOTYPE (wayfinder #10) — THROWAWAY. Variant A: "Room takeover".
// A voice channel is a PLACE — joining swaps the channel pane for a full tile-grid room
// with a bottom control capsule. Browsing a text channel while connected shows a compact
// connection bar in the sidebar footer; clicking the voice row re-enters the room.
import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { Avatar } from "@konus-la/ui/components/avatar";
import { cn } from "@konus-la/ui/lib/utils";
import {
  ChevronUpIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  SignalIcon,
  SlidersHorizontalIcon,
  VideoIcon,
  VideoOffIcon,
  Volume2Icon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import {
  DevicePickerContent,
  FakeCam,
  FakeScreen,
  VolumeSlider,
  useSelfPeer,
} from "./shared";
import { PROTO_VOICE_CHANNELS, getProtoVc, useVoiceProto, voiceProto, type ProtoPeer } from "./store";

/** True while the room should replace the channel pane. Auto-closes when the user
 *  navigates to another text channel (the room is re-entered via the sidebar row). */
export function useVoiceRoomTakeoverA(channelId: string): boolean {
  const { joinedId, roomOpen } = useVoiceProto();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    voiceProto.closeRoom();
  }, [channelId]);
  return joinedId !== null && roomOpen;
}

export function VoiceRoomA() {
  const state = useVoiceProto();
  const self = useSelfPeer();
  const vc = getProtoVc(state.joinedId);
  if (!vc) return null;

  const occupants: ProtoPeer[] = [
    ...vc.peers,
    { ...self, muted: state.selfMuted, deafened: state.selfDeafened, sharing: state.selfSharing, camOn: state.selfCamOn },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <header className="flex items-center gap-1.5 border-b border-foreground/10 px-3 py-2 md:px-4 md:py-2.5">
        <SidebarTrigger className="mr-0.5 md:hidden" />
        <Volume2Icon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">{vc.name}</h1>
        <span className="text-xs text-muted-foreground">· {occupants.length} connected</span>
      </header>

      <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-3 overflow-y-auto p-4">
        {occupants.map((peer) => (
          <RoomTile key={peer.id} peer={peer} speaking={state.speaking.has(peer.id)} />
        ))}
      </div>

      <ControlCapsule />
    </div>
  );
}

function RoomTile({ peer, speaking }: { peer: ProtoPeer; speaking: boolean }) {
  const { volumes } = useVoiceProto();
  const isSelf = peer.id === "self";

  return (
    <div
      className={cn(
        "group relative flex aspect-video w-64 items-center justify-center overflow-hidden bg-muted/60 ring-1 ring-foreground/10",
        peer.sharing && "w-full max-w-2xl",
        speaking && "ring-2 ring-green-500",
      )}
    >
      {peer.sharing ? (
        <FakeScreen className="absolute inset-0" />
      ) : peer.camOn ? (
        <FakeCam className="absolute inset-0" />
      ) : (
        <Avatar
          seed={peer.seed}
          className={cn("size-16 ring-2 ring-foreground/10", speaking && "ring-green-500")}
        />
      )}

      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-background/80 px-1.5 py-0.5 text-xs backdrop-blur-sm">
        {peer.name}
        {isSelf && <span className="text-muted-foreground">(you)</span>}
        {peer.deafened ? (
          <HeadphoneOffIcon className="size-3 text-red-500" />
        ) : peer.muted ? (
          <MicOffIcon className="size-3 text-red-500" />
        ) : null}
      </span>
      {peer.sharing && (
        <span className="absolute top-1.5 left-1.5 bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          LIVE
        </span>
      )}

      {!isSelf && (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Volume for ${peer.name}`}
                className="absolute top-1.5 right-1.5 bg-background/80 opacity-0 backdrop-blur-sm group-hover:opacity-100 data-popup-open:opacity-100"
              />
            }
          >
            <SlidersHorizontalIcon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">{peer.name}</span>
              <span className="text-muted-foreground">{volumes[peer.id] ?? 100}%</span>
            </div>
            <VolumeSlider
              value={volumes[peer.id] ?? 100}
              onChange={(v) => voiceProto.setVolume(peer.id, v)}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function ControlCapsule() {
  const state = useVoiceProto();

  const toggle = (
    label: string,
    active: boolean,
    onClick: () => void,
    OnIcon: typeof MicIcon,
    OffIcon: typeof MicIcon,
    activeIsDanger = true,
  ) => (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(active && activeIsDanger && "bg-red-500/15 text-red-500 hover:text-red-500")}
    >
      {active ? <OffIcon className="size-4.5" /> : <OnIcon className="size-4.5" />}
    </Button>
  );

  return (
    <div className="mx-auto mb-14 flex items-center gap-0.5 bg-background px-1.5 py-1.5 shadow-lg ring-1 ring-foreground/10">
      <div className="flex items-center">
        {toggle("Mute", state.selfMuted, voiceProto.toggleMute, MicIcon, MicOffIcon)}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Audio devices"
                className="-ml-1 w-4 text-muted-foreground"
              />
            }
          >
            <ChevronUpIcon className="size-3" />
          </PopoverTrigger>
          <PopoverContent side="top" align="start">
            <DevicePickerContent />
          </PopoverContent>
        </Popover>
      </div>
      {toggle("Deafen", state.selfDeafened, voiceProto.toggleDeafen, HeadphonesIcon, HeadphoneOffIcon)}
      <div className="mx-1 h-5 w-px bg-foreground/10" />
      {toggle(
        state.selfSharing ? "Stop sharing" : "Share screen",
        state.selfSharing,
        voiceProto.toggleShare,
        ScreenShareIcon,
        ScreenShareOffIcon,
        false,
      )}
      {toggle(
        state.selfCamOn ? "Turn off camera" : "Turn on camera",
        state.selfCamOn,
        voiceProto.toggleCam,
        VideoIcon,
        VideoOffIcon,
        false,
      )}
      <div className="mx-1 h-5 w-px bg-foreground/10" />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Disconnect"
        title="Disconnect"
        className="text-red-500 hover:text-red-500"
        onClick={voiceProto.leave}
      >
        <PhoneOffIcon className="size-4.5" />
      </Button>
    </div>
  );
}

/** Sidebar section: voice rows with occupants nested beneath, Discord-style. */
export function SidebarVoiceA() {
  const state = useVoiceProto();
  const self = useSelfPeer();

  return (
    <div className="flex flex-col px-2 pb-2">
      <span className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">Voice</span>
      {PROTO_VOICE_CHANNELS.map((vc) => {
        const joined = state.joinedId === vc.id;
        const occupants: ProtoPeer[] = joined
          ? [...vc.peers, { ...self, muted: state.selfMuted, deafened: state.selfDeafened }]
          : vc.peers;
        return (
          <div key={vc.id} className="flex flex-col">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                joined && "text-foreground",
              )}
              onClick={() => (joined ? voiceProto.openRoom() : voiceProto.join(vc.id))}
            >
              <Volume2Icon className="size-4 shrink-0 opacity-60" />
              <span className="truncate">{vc.name}</span>
            </button>
            {occupants.map((peer) => {
              const speaking = state.speaking.has(peer.id);
              return (
                <div
                  key={peer.id}
                  className="flex items-center gap-1.5 py-0.5 pr-2 pl-7 text-xs text-muted-foreground"
                >
                  <Avatar
                    seed={peer.seed}
                    className={cn("size-4.5 ring-1 ring-transparent", speaking && "ring-green-500")}
                  />
                  <span className={cn("truncate", speaking && "text-foreground")}>
                    {peer.name}
                  </span>
                  {peer.deafened ? (
                    <HeadphoneOffIcon className="ml-auto size-3 shrink-0 text-red-500/80" />
                  ) : peer.muted ? (
                    <MicOffIcon className="ml-auto size-3 shrink-0 text-red-500/80" />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Sidebar-footer connection bar (above the UserCard) while connected. */
export function ConnectionBarA() {
  const state = useVoiceProto();
  const vc = getProtoVc(state.joinedId);
  if (!vc) return null;

  return (
    <div className="mb-1 flex items-center gap-2 border-b border-sidebar-border px-1 pb-2">
      <SignalIcon className="size-4 shrink-0 text-green-500" />
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col text-left"
        title="Open voice room"
        onClick={voiceProto.openRoom}
      >
        <span className="truncate text-xs font-medium text-green-500">Voice connected</span>
        <span className="truncate text-xs text-muted-foreground">{vc.name}</span>
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Mute"
        onClick={voiceProto.toggleMute}
        className={cn(state.selfMuted && "text-red-500 hover:text-red-500")}
      >
        {state.selfMuted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Disconnect"
        className="text-red-500 hover:text-red-500"
        onClick={voiceProto.leave}
      >
        <PhoneOffIcon className="size-4" />
      </Button>
    </div>
  );
}
