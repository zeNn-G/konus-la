import { Button } from "@konus-la/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@konus-la/ui/components/dropdown-menu";
import { cn } from "@konus-la/ui/lib/utils";
import {
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  type LucideIcon,
} from "lucide-react";

import type { ScreensharePreset } from "@/lib/voice/store";

import type { VoiceControls } from "./use-voice-room";

type ControlSize = { size: "icon" | "icon-sm"; iconClass: string };

/** The room capsule and the sidebar deck share the same buttons at two densities. */
export const CAPSULE_SIZE: ControlSize = { size: "icon", iconClass: "size-4.5" };
export const DECK_SIZE: ControlSize = { size: "icon-sm", iconClass: "size-4" };

export function ControlToggleButton({
  label,
  active,
  onClick,
  ActiveIcon,
  InactiveIcon,
  danger = true,
  sizing,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Shown while `active` (e.g. MicOff when muted, ScreenShare while sharing). */
  ActiveIcon: LucideIcon;
  InactiveIcon: LucideIcon;
  /** Danger toggles (mute/deafen) go red while active; media toggles just fill. */
  danger?: boolean;
  sizing: ControlSize;
  className?: string;
}) {
  return (
    <Button
      size={sizing.size}
      variant="ghost"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        active && (danger ? "bg-red-500/15 text-red-500 hover:text-red-500" : "bg-muted"),
        className,
      )}
    >
      {active ? (
        <ActiveIcon className={sizing.iconClass} />
      ) : (
        <InactiveIcon className={sizing.iconClass} />
      )}
    </Button>
  );
}

/**
 * The mic button is the one component that knows about a failed capture (spec §UX):
 * on a listen-only join it shows the unavailable treatment and the click retries.
 * A server-mute outranks both other states — the button locks silently (no toast, #49);
 * this tooltip is the one place the target learns why their mic is off.
 */
export function MicButton({
  controls,
  sizing,
  className,
}: {
  controls: VoiceControls;
  sizing: ControlSize;
  className?: string;
}) {
  if (controls.serverMuted) {
    return (
      <Button
        size={sizing.size}
        variant="ghost"
        aria-label="Muted by a moderator"
        aria-disabled
        title="You've been muted by a moderator"
        className={cn("cursor-not-allowed bg-red-500/15 text-red-500 hover:text-red-500", className)}
      >
        <MicOffIcon className={sizing.iconClass} />
      </Button>
    );
  }
  if (controls.micError) {
    return (
      <Button
        size={sizing.size}
        variant="ghost"
        aria-label="Mic unavailable — click to retry"
        title="Mic unavailable — click to retry"
        onClick={controls.toggleMute}
        className={cn("bg-amber-500/15 text-amber-500 hover:text-amber-500", className)}
      >
        <MicOffIcon className={sizing.iconClass} />
      </Button>
    );
  }
  return (
    <ControlToggleButton
      label={controls.selfMute ? "Unmute" : "Mute"}
      active={controls.selfMute}
      onClick={controls.toggleMute}
      ActiveIcon={MicOffIcon}
      InactiveIcon={MicIcon}
      sizing={sizing}
      className={className}
    />
  );
}

const SHARE_QUALITY: Array<{ preset: ScreensharePreset; label: string; hint: string }> = [
  { preset: "720p", label: "720p", hint: "Easy on bandwidth" },
  { preset: "1080p", label: "1080p", hint: "Default" },
  { preset: "1080p60", label: "1080p · 60 fps", hint: "Smooth motion" },
];

/**
 * Quality preset is chosen BEFORE `getDisplayMedia` (spec §Media policy) — the idle
 * button opens the preset popover; while sharing it turns into a plain stop button
 * (changing quality mid-share = stop + re-share, no live renegotiation in v1).
 */
export function ShareButton({
  controls,
  sizing,
  className,
}: {
  controls: VoiceControls;
  sizing: ControlSize;
  className?: string;
}) {
  if (controls.sharing) {
    return (
      <ControlToggleButton
        label="Stop sharing"
        active
        onClick={controls.stopShare}
        ActiveIcon={ScreenShareOffIcon}
        InactiveIcon={ScreenShareIcon}
        danger={false}
        sizing={sizing}
        className={className}
      />
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size={sizing.size}
            variant="ghost"
            aria-label="Share screen"
            title="Share screen"
            className={className}
          />
        }
      >
        <ScreenShareIcon className={sizing.iconClass} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Share quality</DropdownMenuLabel>
          {SHARE_QUALITY.map(({ preset, label, hint }) => (
            <DropdownMenuItem key={preset} onClick={() => controls.startShare(preset)}>
              <span className="flex-1">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </DropdownMenuItem>
          ))}
          {/* The browser picker is the only surface for the audio opt-in. */}
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            For sound, tick “also share tab audio” in the picker.
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
