import { Button } from "@konus-la/ui/components/button";
import {
  ChevronUpIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";

import { useUserSettings } from "@/lib/user-settings";

import { CAPSULE_SIZE, ControlToggleButton, MicButton, ShareButton } from "./control-buttons";
import { useVoiceControls } from "./use-voice-room";

/**
 * In-room controls, docked bottom-center of the VoiceRoom pane (decision #10 variant A).
 * The chevron beside the mic opens the user-settings dialog at Voice (#85).
 */
export function ControlCapsule() {
  const controls = useVoiceControls();
  const openSettingsAt = useUserSettings((s) => s.openAt);

  return (
    <div className="mx-auto mb-14 flex items-center gap-0.5 bg-background px-1.5 py-1.5 shadow-lg ring-1 ring-foreground/10">
      <MicButton controls={controls} sizing={CAPSULE_SIZE} />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Voice settings"
        title="Voice settings"
        className="-ml-1 w-4"
        onClick={() => openSettingsAt("voice")}
      >
        <ChevronUpIcon className="size-3.5" />
      </Button>
      <ControlToggleButton
        label={controls.selfDeaf ? "Undeafen" : "Deafen"}
        active={controls.selfDeaf}
        onClick={controls.toggleDeafen}
        ActiveIcon={HeadphoneOffIcon}
        InactiveIcon={HeadphonesIcon}
        sizing={CAPSULE_SIZE}
      />
      <div className="mx-1 h-5 w-px bg-foreground/10" />
      <ShareButton controls={controls} sizing={CAPSULE_SIZE} />
      <ControlToggleButton
        label={controls.camOn ? "Turn off camera" : "Turn on camera"}
        active={controls.camOn}
        onClick={controls.toggleCam}
        ActiveIcon={VideoOffIcon}
        InactiveIcon={VideoIcon}
        danger={false}
        sizing={CAPSULE_SIZE}
      />
      <div className="mx-1 h-5 w-px bg-foreground/10" />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Disconnect"
        title="Disconnect"
        className="text-red-500 hover:text-red-500"
        onClick={controls.disconnect}
      >
        <PhoneOffIcon className="size-4.5" />
      </Button>
    </div>
  );
}
