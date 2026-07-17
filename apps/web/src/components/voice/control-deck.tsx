import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import { cn } from "@konus-la/ui/lib/utils";
import {
  HeadphoneOffIcon,
  HeadphonesIcon,
  PhoneOffIcon,
  Settings2Icon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";

import { useDeviceStore } from "@/lib/voice/devices";
import { useVoiceStore } from "@/lib/voice/store";

// PROTOTYPE — THROWAWAY (wayfinder ticket #77): in variant A the gear opens the
// user-settings dialog at Voice (devices move there); B/C keep the popover.
import { usePrototypeStore } from "@/components/user-settings-prototype/store";
import { useSettingsVariant } from "@/components/user-settings-prototype/use-variant";

import { ControlToggleButton, DECK_SIZE, MicButton, ShareButton } from "./control-buttons";
import { DevicePicker } from "./device-picker";
import { useVoiceChannelName, useVoiceControls } from "./use-voice-room";

/**
 * Sidebar-footer control deck (decision #10 variant B), above the UserCard. Visible the
 * whole time a session exists — in the room and while browsing text. The settings button
 * opens the DevicePicker; its popover is store-controlled so the device-fallback toast's
 * **Change** action can open it from anywhere (#25).
 */
export function ControlDeck() {
  const status = useVoiceStore((s) => s.status);
  const guildId = useVoiceStore((s) => s.guildId);
  const channelId = useVoiceStore((s) => s.channelId);
  const controls = useVoiceControls();
  const channelName = useVoiceChannelName(guildId, channelId);
  const pickerOpen = useDeviceStore((s) => s.pickerOpen);
  const setPickerOpen = useDeviceStore((s) => s.setPickerOpen);
  // PROTOTYPE (ticket #77)
  const settingsVariant = useSettingsVariant();
  const openSettings = usePrototypeStore((s) => s.openAt);

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
        {settingsVariant === "a" ? (
          // PROTOTYPE variant A: devices moved into the user-settings dialog.
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Voice settings"
            title="Voice settings"
            className="text-muted-foreground"
            onClick={() => openSettings("voice")}
          >
            <Settings2Icon className="size-3.5" />
          </Button>
        ) : (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Voice settings"
                  title="Voice settings"
                  className="text-muted-foreground"
                />
              }
            >
              <Settings2Icon className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={8}>
              <DevicePicker />
            </PopoverContent>
          </Popover>
        )}
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
