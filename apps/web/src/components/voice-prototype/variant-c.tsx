// VOICE UX PROTOTYPE (wayfinder #10) — THROWAWAY. Variant C: "Split stage".
// Voice and text coexist: a filmstrip of tiles docks between the channel header and the
// messages, with the controls inline at its right end. Collapses to an avatar row.
// Speaking = everyone else dims and the speaker gets a green baseline bar (no rings).
// Sidebar voice rows carry a facepile instead of a nested list.
import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { cn } from "@konus-la/ui/lib/utils";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  MoreVerticalIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  VideoIcon,
  Volume2Icon,
} from "lucide-react";
import { useState } from "react";

import { DevicePickerContent, FakeCam, FakeScreen, VolumeSlider, useSelfPeer } from "./shared";
import { PROTO_VOICE_CHANNELS, getProtoVc, useVoiceProto, voiceProto, type ProtoPeer } from "./store";

/** The strip between the channel header and the message list. */
export function VoiceStripC() {
  const state = useVoiceProto();
  const self = useSelfPeer();
  const [collapsed, setCollapsed] = useState(false);
  const vc = getProtoVc(state.joinedId);
  if (!vc) return null;

  const occupants: ProtoPeer[] = [
    ...vc.peers,
    { ...self, muted: state.selfMuted, deafened: state.selfDeafened, sharing: state.selfSharing, camOn: state.selfCamOn },
  ];
  const anySpeaking = occupants.some((p) => state.speaking.has(p.id));

  return (
    <div className="flex shrink-0 items-stretch gap-2 border-b border-foreground/10 bg-sidebar px-3 py-2">
      {collapsed ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Volume2Icon className="size-4 shrink-0 text-green-500" />
          <span className="text-xs font-medium">{vc.name}</span>
          {occupants.map((peer) => {
            const speaking = state.speaking.has(peer.id);
            return (
              <Avatar
                key={peer.id}
                seed={peer.seed}
                className={cn(
                  "size-6 transition-opacity",
                  anySpeaking && !speaking && "opacity-50",
                )}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {occupants.map((peer) => (
            <StripTile key={peer.id} peer={peer} dimmed={anySpeaking && !state.speaking.has(peer.id)} speaking={state.speaking.has(peer.id)} />
          ))}
        </div>
      )}

      <StripControls collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
    </div>
  );
}

function StripTile({
  peer,
  speaking,
  dimmed,
}: {
  peer: ProtoPeer;
  speaking: boolean;
  dimmed: boolean;
}) {
  const { volumes } = useVoiceProto();
  const isSelf = peer.id === "self";

  const tile = (
    <div
      className={cn(
        "relative flex h-28 w-44 shrink-0 items-center justify-center overflow-hidden bg-muted/60 ring-1 ring-foreground/10 transition-opacity",
        peer.sharing && "w-72",
        dimmed && "opacity-50",
      )}
    >
      {peer.sharing ? (
        <FakeScreen className="absolute inset-0" />
      ) : peer.camOn ? (
        <FakeCam className="absolute inset-0" />
      ) : (
        <Avatar seed={peer.seed} className="size-10" />
      )}
      <span className="absolute bottom-0 left-0 flex items-center gap-1 bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur-sm">
        {isSelf ? "You" : peer.name}
        {peer.deafened ? (
          <HeadphoneOffIcon className="size-2.5 text-red-500" />
        ) : peer.muted ? (
          <MicOffIcon className="size-2.5 text-red-500" />
        ) : null}
      </span>
      {peer.sharing && (
        <span className="absolute top-0 left-0 bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
          LIVE
        </span>
      )}
      {/* Speaking = green baseline bar, not a ring. */}
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 h-0.5 bg-green-500 opacity-0 transition-opacity",
          speaking && "opacity-100",
        )}
      />
    </div>
  );

  if (isSelf) return tile;
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" className="shrink-0 text-left" />}>
        {tile}
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3">
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
  );
}

function StripControls({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const state = useVoiceProto();

  const btn = (
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
      className={cn(active && (danger ? "bg-red-500/15 text-red-500 hover:text-red-500" : "bg-muted"))}
    >
      {active ? <ActiveIcon className="size-4" /> : <Icon className="size-4" />}
    </Button>
  );

  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-4 content-center gap-0.5 border-l border-foreground/10 pl-2",
        collapsed && "flex items-center",
      )}
    >
      {btn("Mute", state.selfMuted, voiceProto.toggleMute, MicIcon, MicOffIcon)}
      {btn("Deafen", state.selfDeafened, voiceProto.toggleDeafen, HeadphonesIcon, HeadphoneOffIcon)}
      {btn("Share screen", state.selfSharing, voiceProto.toggleShare, ScreenShareIcon, ScreenShareIcon, false)}
      {btn("Camera", state.selfCamOn, voiceProto.toggleCam, VideoIcon, VideoIcon, false)}
      <Popover>
        <PopoverTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label="Audio devices" />}
        >
          <MoreVerticalIcon className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end">
          <DevicePickerContent />
        </PopoverContent>
      </Popover>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Disconnect"
        title="Disconnect"
        className="text-red-500 hover:text-red-500"
        onClick={voiceProto.leave}
      >
        <PhoneOffIcon className="size-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={collapsed ? "Expand voice strip" : "Collapse voice strip"}
        title={collapsed ? "Expand" : "Collapse"}
        className="col-span-2"
        onClick={onToggleCollapsed}
      >
        {collapsed ? <ChevronDownIcon className="size-4" /> : <ChevronUpIcon className="size-4" />}
      </Button>
    </div>
  );
}

/** Sidebar voice rows with an occupant facepile on the row itself — no nested list. */
export function SidebarVoiceC() {
  const state = useVoiceProto();
  const self = useSelfPeer();

  return (
    <div className="flex flex-col px-2 pb-2">
      <span className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">Voice</span>
      {PROTO_VOICE_CHANNELS.map((vc) => {
        const joined = state.joinedId === vc.id;
        const occupants: ProtoPeer[] = joined ? [...vc.peers, self] : vc.peers;
        return (
          <button
            key={vc.id}
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
              joined && "bg-muted text-foreground",
            )}
            onClick={() => voiceProto.join(vc.id)}
          >
            <Volume2Icon className="size-4 shrink-0 opacity-60" />
            <span className="truncate">{vc.name}</span>
            <span className="ml-auto flex -space-x-1.5">
              {occupants.slice(0, 4).map((peer) => (
                <Avatar
                  key={peer.id}
                  seed={peer.seed}
                  className={cn(
                    "size-4.5 ring-1 ring-sidebar",
                    state.speaking.has(peer.id) && "ring-green-500",
                  )}
                />
              ))}
              {occupants.length > 4 && (
                <span className="z-10 flex size-4.5 items-center justify-center bg-muted text-[9px] ring-1 ring-sidebar">
                  +{occupants.length - 4}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
