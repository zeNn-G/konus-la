// VOICE UX PROTOTYPE (wayfinder #10) — THROWAWAY. Variant B: "Voice rides along".
// You never leave text chat. Connected voice lives in the sidebar: an occupant panel with
// always-visible per-peer volume sliders docked above the footer, and the footer itself
// becomes a control deck. In the chat pane a floating mini-stage shows the loudest thing
// (screenshare, else active speaker); expand it for a full overlay grid.
import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { cn } from "@konus-la/ui/lib/utils";
import {
  HeadphoneOffIcon,
  HeadphonesIcon,
  Maximize2Icon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  SettingsIcon,
  VideoIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { DevicePickerContent, FakeCam, FakeScreen, VolumeSlider, useSelfPeer } from "./shared";
import { PROTO_VOICE_CHANNELS, getProtoVc, useVoiceProto, voiceProto, type ProtoPeer } from "./store";

/** Sidebar section: lightweight voice rows — occupancy is just a count, detail lives in
 *  the connected panel down by the footer. */
export function SidebarVoiceB() {
  const { joinedId } = useVoiceProto();

  return (
    <div className="flex flex-col px-2 pb-2">
      <span className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">Voice</span>
      {PROTO_VOICE_CHANNELS.map((vc) => (
        <button
          key={vc.id}
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
            joinedId === vc.id && "bg-muted text-foreground",
          )}
          onClick={() => voiceProto.join(vc.id)}
        >
          <Volume2Icon className="size-4 shrink-0 opacity-60" />
          <span className="truncate">{vc.name}</span>
          <span className="ml-auto bg-muted px-1.5 text-xs text-muted-foreground">
            {vc.peers.length + (joinedId === vc.id ? 1 : 0)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Footer stack (above the UserCard): occupant panel with inline volume sliders + the
 *  control deck. Everything you touch while in voice is within thumb's reach of your card. */
export function FooterDeckB() {
  const state = useVoiceProto();
  const self = useSelfPeer();
  const vc = getProtoVc(state.joinedId);
  if (!vc) return null;

  const rows: ProtoPeer[] = [
    { ...self, muted: state.selfMuted, deafened: state.selfDeafened },
    ...vc.peers,
  ];

  const deckButton = (
    label: string,
    active: boolean,
    onClick: () => void,
    Icon: typeof MicIcon,
    ActiveIcon: typeof MicIcon,
    danger = true,
  ) => (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("flex-1", active && (danger ? "bg-red-500/15 text-red-500 hover:text-red-500" : "bg-muted"))}
    >
      {active ? <ActiveIcon className="size-4" /> : <Icon className="size-4" />}
    </Button>
  );

  return (
    <div className="mb-1 flex flex-col border-b border-sidebar-border pb-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs font-medium text-green-500">Voice · {vc.name}</span>
        <span className="text-[10px] text-muted-foreground">32 ms</span>
      </div>

      <div className="flex flex-col gap-1 px-1 pb-2">
        {rows.map((peer) => {
          const speaking = state.speaking.has(peer.id);
          return (
            <div key={peer.id} className="flex items-center gap-1.5 text-xs">
              <Avatar
                seed={peer.seed}
                className={cn("size-5 ring-1 ring-transparent", speaking && "ring-green-500")}
              />
              <span
                className={cn(
                  "w-16 truncate text-muted-foreground",
                  speaking && "font-medium text-foreground",
                )}
              >
                {peer.id === "self" ? "You" : peer.name}
              </span>
              {peer.id === "self" ? (
                <span className="flex-1" />
              ) : (
                <VolumeSlider
                  value={state.volumes[peer.id] ?? 100}
                  onChange={(v) => voiceProto.setVolume(peer.id, v)}
                  className="flex-1"
                />
              )}
              {peer.deafened ? (
                <HeadphoneOffIcon className="size-3 shrink-0 text-red-500/80" />
              ) : peer.muted ? (
                <MicOffIcon className="size-3 shrink-0 text-red-500/80" />
              ) : (
                <span className="size-3 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 px-1">
        {deckButton("Mute", state.selfMuted, voiceProto.toggleMute, MicIcon, MicOffIcon)}
        {deckButton("Deafen", state.selfDeafened, voiceProto.toggleDeafen, HeadphonesIcon, HeadphoneOffIcon)}
        {deckButton("Share screen", state.selfSharing, voiceProto.toggleShare, ScreenShareIcon, ScreenShareIcon, false)}
        {deckButton("Camera", state.selfCamOn, voiceProto.toggleCam, VideoIcon, VideoIcon, false)}
        <Popover>
          <PopoverTrigger
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Voice settings" className="flex-1" />
            }
          >
            <SettingsIcon className="size-4" />
          </PopoverTrigger>
          <PopoverContent side="top" align="start">
            <DevicePickerContent />
          </PopoverContent>
        </Popover>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Disconnect"
          title="Disconnect"
          className="flex-1 text-red-500 hover:text-red-500"
          onClick={voiceProto.leave}
        >
          <PhoneOffIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Floating mini-stage in the chat pane corner; expands to a full overlay grid. */
export function VoiceMiniStageB() {
  const state = useVoiceProto();
  const self = useSelfPeer();
  const [expanded, setExpanded] = useState(false);
  const vc = getProtoVc(state.joinedId);
  if (!vc) return null;

  const occupants: ProtoPeer[] = [
    ...vc.peers,
    { ...self, muted: state.selfMuted, sharing: state.selfSharing, camOn: state.selfCamOn },
  ];
  const sharer = occupants.find((p) => p.sharing);
  const activeSpeaker = occupants.find((p) => state.speaking.has(p.id)) ?? occupants[0]!;

  if (expanded) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Volume2Icon className="size-4 text-green-500" />
          <span className="text-sm font-medium">{vc.name}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Collapse"
            className="ml-auto"
            onClick={() => setExpanded(false)}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-2 overflow-y-auto p-3">
          {occupants.map((peer) => {
            const speaking = state.speaking.has(peer.id);
            return (
              <div
                key={peer.id}
                className={cn(
                  "relative flex aspect-video w-52 items-center justify-center overflow-hidden bg-muted/60 ring-1 ring-foreground/10",
                  peer.sharing && "w-full max-w-xl",
                  speaking && "ring-2 ring-green-500",
                )}
              >
                {peer.sharing ? (
                  <FakeScreen className="absolute inset-0" />
                ) : peer.camOn ? (
                  <FakeCam className="absolute inset-0" />
                ) : (
                  <Avatar seed={peer.seed} className="size-12" />
                )}
                <span className="absolute bottom-1 left-1 bg-background/80 px-1.5 py-0.5 text-xs backdrop-blur-sm">
                  {peer.id === "self" ? "You" : peer.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-3 bottom-24 z-30 flex w-56 flex-col bg-background shadow-lg ring-1 ring-foreground/10">
      <div className="relative h-32 overflow-hidden">
        {sharer ? (
          <FakeScreen className="absolute inset-0" />
        ) : activeSpeaker.camOn ? (
          <FakeCam className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
            <Avatar
              seed={activeSpeaker.seed}
              className={cn(
                "size-12 ring-2 ring-transparent",
                state.speaking.has(activeSpeaker.id) && "ring-green-500",
              )}
            />
          </div>
        )}
        <span className="absolute bottom-1 left-1 bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur-sm">
          {sharer ? `${sharer.name}'s screen` : activeSpeaker.id === "self" ? "You" : activeSpeaker.name}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Expand voice"
          className="absolute top-1 right-1 bg-background/80 backdrop-blur-sm"
          onClick={() => setExpanded(true)}
        >
          <Maximize2Icon className="size-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5">
        {occupants.map((peer) => (
          <Avatar
            key={peer.id}
            seed={peer.seed}
            className={cn(
              "size-5 ring-1 ring-transparent",
              state.speaking.has(peer.id) && "ring-green-500",
            )}
          />
        ))}
        <span className="ml-auto text-[10px] text-green-500">{vc.name}</span>
      </div>
    </div>
  );
}
