import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import {
  HeadphoneOffIcon,
  HeadphonesIcon,
  PhoneOffIcon,
  Settings2Icon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";

import { useUserSettings } from "@/lib/user-settings";
import { useVoiceStore } from "@/lib/voice/store";

import { ControlToggleButton, DECK_SIZE, MicButton, ShareButton } from "./control-buttons";
import { useVoiceChannelName, useVoiceControls } from "./use-voice-room";

/**
 * Sidebar-footer control deck (decision #10 variant B), above the UserCard. Visible the
 * whole time a session exists — in the room and while browsing text. The gear opens the
 * user-settings dialog at Voice (#85), the same section the device-fallback toast's
 * **Change** action lands on (#25).
 */
export function ControlDeck() {
  const status = useVoiceStore((s) => s.status);
  const guildId = useVoiceStore((s) => s.guildId);
  const channelId = useVoiceStore((s) => s.channelId);
  const controls = useVoiceControls();
  const channelName = useVoiceChannelName(guildId, channelId);
  const openSettingsAt = useUserSettings((s) => s.openAt);

  if (status === "idle") return null;

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
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Voice settings"
          title="Voice settings"
          className="text-muted-foreground"
          onClick={() => openSettingsAt("voice")}
        >
          <Settings2Icon className="size-3.5" />
        </Button>
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
        <ShareButton controls={controls} sizing={DECK_SIZE} className="flex-1" />
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
