import { Button } from "@konus-la/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@konus-la/ui/components/popover";
import {
  ChevronUpIcon,
  HeadphoneOffIcon,
  HeadphonesIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";

import { CAPSULE_SIZE, ControlToggleButton, MicButton, ShareButton } from "./control-buttons";
import { DevicePicker } from "./device-picker";
import { useVoiceControls } from "./use-voice-room";

/**
 * In-room controls, docked bottom-center of the VoiceRoom pane (decision #10 variant A).
 * The chevron beside the mic opens the DevicePicker (#25).
 */
export function ControlCapsule() {
  const controls = useVoiceControls();

  return (
    <div className="mx-auto mb-14 flex items-center gap-0.5 bg-background px-1.5 py-1.5 shadow-lg ring-1 ring-foreground/10">
      <MicButton controls={controls} sizing={CAPSULE_SIZE} />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Audio devices"
              title="Audio devices"
              className="-ml-1 w-4"
            />
          }
        >
          <ChevronUpIcon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={10}>
          <DevicePicker />
        </PopoverContent>
      </Popover>
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
