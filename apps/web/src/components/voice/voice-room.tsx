import { Button } from "@konus-la/ui/components/button";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { cn } from "@konus-la/ui/lib/utils";
import { PhoneIcon, Volume2Icon } from "lucide-react";

import { voiceSession } from "@/lib/voice/session";
import { useVoiceStore } from "@/lib/voice/store";
import { deriveStageLayout } from "@/lib/voice/ui-model";

import { ControlCapsule } from "./control-capsule";
import { RoomTile } from "./room-tile";
import { useRoomTiles, useStageFocus, useStageFullscreen } from "./use-voice-room";

/**
 * Channel-pane takeover for a voice channel (decision #10 variant A): tile grid plus
 * the bottom control capsule. Rendered whenever the route's channel is `kind: "voice"` —
 * seated or not; un-seated visitors get an occupancy preview and a join capsule.
 *
 * With a share focused (#32) the same keyed tile list re-lays into stage + filmstrip via
 * grid placement — tiles never remount across mode switches, so video interest refcounts
 * (and the underlying consumers) are untouched by layout changes.
 */
export function VoiceRoom({
  guildId,
  channelId,
  channelName,
}: {
  guildId: string;
  channelId: string;
  channelName: string;
}) {
  const { tiles, connectedHere } = useRoomTiles(guildId, channelId);
  const status = useVoiceStore((s) => s.status);
  const stageFocus = useStageFocus(tiles, connectedHere);
  const fullscreen = useStageFullscreen();
  const layout = deriveStageLayout(tiles, stageFocus.focusedUserId);
  // The join button and the capsule share the same centered slot. Swapping the live
  // capsule in while the join click is still settling lets the tail of that click land
  // on a control button (observed: instant self-mute) — so during "joining" the slot
  // holds a disabled placeholder instead.
  const joining = connectedHere && status === "joining";

  // Both modes render one flat keyed array so React reconciles tile-by-tile instead of
  // replacing the whole child list when focus toggles.
  const tileNodes = layout
    ? [
        ...layout.views.map((view) => (
          <RoomTile
            key={view.tile.userId}
            guildId={guildId}
            tile={view.tile}
            variant={view.variant}
            face={view.face}
            onFocusShare={view.variant === "stage" ? undefined : stageFocus.focus}
            stage={
              view.variant === "stage"
                ? {
                    ref: fullscreen.ref,
                    fullscreen: fullscreen.fullscreen,
                    onToggleFullscreen: fullscreen.toggle,
                    onMinimize: stageFocus.minimize,
                  }
                : undefined
            }
          />
        )),
        ...(layout.sharerCam
          ? [
              <RoomTile
                key={`${layout.sharerCam.tile.userId}:cam`}
                guildId={guildId}
                tile={layout.sharerCam.tile}
                variant="strip"
                face={layout.sharerCam.face}
              />,
            ]
          : []),
      ]
    : tiles.map((tile) => (
        <RoomTile key={tile.userId} guildId={guildId} tile={tile} onFocusShare={stageFocus.focus} />
      ));

  const stripCount = layout ? layout.views.length - 1 + (layout.sharerCam ? 1 : 0) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <header className="flex items-center gap-1.5 border-b border-foreground/10 px-3 py-2 md:px-4 md:py-2.5">
        <SidebarTrigger className="mr-0.5 md:hidden" />
        <Volume2Icon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">{channelName}</h1>
        {tiles.length > 0 && (
          <span className="text-xs text-muted-foreground">· {tiles.length} connected</span>
        )}
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 gap-3 p-4",
          layout
            ? "grid content-stretch overflow-hidden"
            : "flex flex-wrap content-center items-center justify-center overflow-y-auto",
        )}
        style={
          layout
            ? {
                gridTemplateRows: "minmax(0, 1fr) auto",
                // 1fr columns so the col-span-full stage fills the pane width; the strip
                // tiles center themselves inside their tracks.
                gridTemplateColumns: `repeat(${Math.max(1, stripCount)}, minmax(0, 1fr))`,
              }
            : undefined
        }
      >
        {tiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">It’s quiet in here.</p>
        ) : (
          tileNodes
        )}
      </div>

      {connectedHere && !joining ? (
        <ControlCapsule />
      ) : (
        <div className="mx-auto mb-14 flex items-center bg-background px-1.5 py-1.5 shadow-lg ring-1 ring-foreground/10">
          <Button
            size="sm"
            disabled={joining}
            onClick={() => void voiceSession.join({ channelId, guildId })}
          >
            <PhoneIcon data-icon="inline-start" />
            {joining ? "Joining…" : "Join voice"}
          </Button>
        </div>
      )}
    </div>
  );
}
