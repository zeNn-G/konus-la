import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { HeadphoneOffIcon, MaximizeIcon, MicOffIcon, Minimize2Icon, MinimizeIcon } from "lucide-react";

import type { RoomTileModel, TileFace } from "@/lib/voice/ui-model";

import { PeerVolumeMenu } from "./peer-volume-menu";
import { VideoSurface } from "./video-surface";

export type RoomTileVariant = "grid" | "stage" | "strip";

type StageControls = {
  /** Fullscreen target — the tile container itself. */
  ref: (node: HTMLDivElement | null) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onMinimize: () => void;
};

/**
 * One occupant in the room: screenshare > camera > avatar face, LIVE badge while sharing,
 * square green speaking ring (decision #10). Right-click on a remote peer opens the
 * per-peer volume menu. Variants (#32): `grid` — one tile among equals; `stage` — the
 * focused share filling the pane, with minimize/fullscreen hover controls; `strip` — a
 * thin filmstrip entry (never a screen face). Clicking a LIVE grid/strip tile focuses
 * that share.
 */
export function RoomTile({
  tile,
  variant = "grid",
  face = tile.face,
  onFocusShare,
  stage,
}: {
  tile: RoomTileModel;
  variant?: RoomTileVariant;
  /** Face to render here — the stage keeps `tile.face`, strip entries pass `camFace`. */
  face?: TileFace;
  onFocusShare?: (userId: string) => void;
  stage?: StageControls;
}) {
  const focusable = variant !== "stage" && tile.live && onFocusShare !== undefined;

  return (
    <PeerVolumeMenu
      userId={tile.userId}
      name={tile.name}
      enabled={!tile.isSelf}
      render={
        <div
          ref={stage?.ref}
          onClick={focusable ? () => onFocusShare(tile.userId) : undefined}
          onDoubleClick={stage ? stage.onToggleFullscreen : undefined}
          title={
            focusable
              ? tile.isSelf
                ? "Focus your screen"
                : `Watch ${tile.name}'s screen`
              : undefined
          }
          className={cn(
            "group relative flex items-center justify-center overflow-hidden bg-muted/60 ring-1 ring-foreground/10",
            variant === "grid" && "aspect-video w-64",
            variant === "grid" && tile.live && "w-full max-w-2xl",
            variant === "stage" && "col-span-full row-start-1 h-full w-full min-h-0 min-w-0",
            variant === "strip" && "row-start-2 aspect-video h-20 shrink-0 justify-self-center",
            focusable && "cursor-pointer",
            tile.speaking && "ring-2 ring-green-500",
          )}
        />
      }
    >
      {face.kind === "avatar" ? (
        <Avatar
          seed={tile.seed}
          src={tile.image}
          className={cn(
            "ring-2 ring-foreground/10",
            variant === "strip" ? "size-8" : "size-16",
            tile.speaking && "ring-green-500",
          )}
        />
      ) : (
        <VideoSurface face={face} className="absolute inset-0 h-full w-full" />
      )}

      <span
        className={cn(
          "absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-background/80 px-1.5 py-0.5 text-xs backdrop-blur-sm",
          variant === "strip" && "bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate px-1 py-0",
        )}
      >
        {tile.name}
        {tile.isSelf && variant !== "strip" && <span className="text-muted-foreground">(you)</span>}
        {tile.selfDeaf ? (
          <HeadphoneOffIcon className="size-3 shrink-0 text-red-500" />
        ) : tile.selfMute ? (
          <MicOffIcon className="size-3 shrink-0 text-red-500" />
        ) : null}
      </span>

      {tile.live && (
        <span
          className={cn(
            "absolute top-1.5 left-1.5 bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white",
            variant === "strip" && "top-1 left-1 px-1",
          )}
        >
          LIVE
        </span>
      )}

      {stage && (
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Minimize"
            title="Minimize"
            className="bg-background/80 backdrop-blur-sm"
            onClick={stage.onMinimize}
          >
            <Minimize2Icon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={stage.fullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={stage.fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="bg-background/80 backdrop-blur-sm"
            onClick={stage.onToggleFullscreen}
          >
            {stage.fullscreen ? (
              <MinimizeIcon className="size-4" />
            ) : (
              <MaximizeIcon className="size-4" />
            )}
          </Button>
        </div>
      )}
    </PeerVolumeMenu>
  );
}
