import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  HeadphoneOffIcon,
  HeadphonesIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";

import { useVoiceStore } from "@/lib/voice/store";
import { orpc } from "@/utils/orpc";

import { ControlToggleButton, DECK_SIZE, MicButton } from "./control-buttons";
import { useVoiceControls } from "./use-voice-room";

/**
 * Sidebar-footer control deck (decision #10 variant B), above the UserCard. Visible the
 * whole time a session exists — in the room and while browsing text. The settings
 * popover (device picker) arrives with issue #25.
 */
export function ControlDeck() {
  const status = useVoiceStore((s) => s.status);
  const guildId = useVoiceStore((s) => s.guildId);
  const channelId = useVoiceStore((s) => s.channelId);
  const controls = useVoiceControls();

  const channels = useQuery({
    ...orpc.channel.list.queryOptions({ input: { guildId: guildId ?? "" } }),
    enabled: guildId !== null,
  });

  if (status === "idle") return null;

  const channelName = channels.data?.find((c) => c.id === channelId)?.name ?? "";
  const statusLine =
    status === "connected" ? "Voice" : status === "joining" ? "Joining…" : "Reconnecting…";

  return (
    <div className="mb-1 flex flex-col border-b border-sidebar-border pb-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span
          className={cn(
            "truncate text-xs font-medium",
            status === "connected" ? "text-green-500" : "text-amber-500",
          )}
        >
          {statusLine}
          {channelName && ` · ${channelName}`}
        </span>
      </div>

      <div className="flex items-center gap-0.5 px-1">
        <MicButton controls={controls} sizing={DECK_SIZE} className="flex-1" />
        <ControlToggleButton
          label={controls.selfDeaf ? "Undeafen" : "Deafen"}
          active={controls.selfDeaf}
          onClick={controls.toggleDeafen}
          ActiveIcon={HeadphoneOffIcon}
          InactiveIcon={HeadphonesIcon}
          sizing={DECK_SIZE}
          className="flex-1"
        />
        <ControlToggleButton
          label={controls.sharing ? "Stop sharing" : "Share screen"}
          active={controls.sharing}
          onClick={controls.toggleShare}
          ActiveIcon={ScreenShareOffIcon}
          InactiveIcon={ScreenShareIcon}
          danger={false}
          sizing={DECK_SIZE}
          className="flex-1"
        />
        <ControlToggleButton
          label={controls.camOn ? "Turn off camera" : "Turn on camera"}
          active={controls.camOn}
          onClick={controls.toggleCam}
          ActiveIcon={VideoOffIcon}
          InactiveIcon={VideoIcon}
          danger={false}
          sizing={DECK_SIZE}
          className="flex-1"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Disconnect"
          title="Disconnect"
          className="flex-1 text-red-500 hover:text-red-500"
          onClick={controls.disconnect}
        >
          <PhoneOffIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
