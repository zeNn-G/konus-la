import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@konus-la/ui/components/context-menu";
import { Slider } from "@konus-la/ui/components/slider";
import { Volume2Icon, VolumeOffIcon } from "lucide-react";
import { cloneElement, useEffect, type ReactElement, type ReactNode } from "react";

import { useVoiceStore } from "@/lib/voice/store";

/** Pre-mute volumes so "Unmute for you" restores where the peer was, not full blast. */
const restoreVolumes = new Map<string, number>();

type PeerVolumeMenuProps = {
  userId: string;
  name: string;
  /** False for self — your own volume isn't a thing; the element renders bare. */
  enabled: boolean;
  /** The element the menu attaches to (it becomes the right-click target). */
  render: ReactElement<Record<string, unknown>>;
  children?: ReactNode;
};

/**
 * Right-click per-peer volume menu (decision #10): slider plus a local mute that only
 * affects this client. Volume 0 IS the local mute — the audio bridge reads the same
 * store field either way.
 */
export function PeerVolumeMenu({ userId, name, enabled, render, children }: PeerVolumeMenuProps) {
  const volume = useVoiceStore((s) => s.volumes[userId] ?? 1);
  const setVolume = useVoiceStore((s) => s.setVolume);

  // Remember the last audible volume however it was reached — menu item OR slider
  // dragged to zero — so "Unmute for you" always returns there.
  useEffect(() => {
    if (volume > 0) restoreVolumes.set(userId, volume);
  }, [userId, volume]);

  if (!enabled) return cloneElement(render, undefined, children);

  const locallyMuted = volume === 0;
  const toggleLocalMute = () => {
    if (locallyMuted) {
      setVolume(userId, restoreVolumes.get(userId) ?? 1);
    } else {
      setVolume(userId, 0);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuGroup>
          <ContextMenuLabel className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-foreground">{name}</span>
            <span>{Math.round(volume * 100)}%</span>
          </ContextMenuLabel>
          <div className="px-2 pb-2">
            <Slider
              aria-label={`Volume for ${name}`}
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onValueChange={(value) =>
                setVolume(userId, (Array.isArray(value) ? (value[0] ?? 0) : value) / 100)
              }
            />
          </div>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={toggleLocalMute}>
          {locallyMuted ? <Volume2Icon /> : <VolumeOffIcon />}
          {locallyMuted ? "Unmute for you" : "Mute for you"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
