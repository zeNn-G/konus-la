import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { MicIcon, MicOffIcon, type LucideIcon } from "lucide-react";

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
