import { Avatar } from "@konus-la/ui/components/avatar";
import { cn } from "@konus-la/ui/lib/utils";
import { HeadphoneOffIcon, MicOffIcon } from "lucide-react";

import type { RoomTileModel } from "@/lib/voice/ui-model";

import { PeerVolumeMenu } from "./peer-volume-menu";
import { VideoSurface } from "./video-surface";

/**
 * One occupant in the room grid: screenshare > camera > avatar face, LIVE badge while
 * sharing, square green speaking ring (decision #10). Right-click on a remote peer
 * opens the per-peer volume menu.
 */
export function RoomTile({ tile }: { tile: RoomTileModel }) {
  return (
    <PeerVolumeMenu
      userId={tile.userId}
      name={tile.name}
      enabled={!tile.isSelf}
      render={
        <div
          className={cn(
            "relative flex aspect-video w-64 items-center justify-center overflow-hidden bg-muted/60 ring-1 ring-foreground/10",
            tile.live && "w-full max-w-2xl",
            tile.speaking && "ring-2 ring-green-500",
          )}
        />
      }
    >
      {tile.face.kind === "avatar" ? (
        <Avatar
          seed={tile.seed}
          src={tile.image}
          className={cn("size-16 ring-2 ring-foreground/10", tile.speaking && "ring-green-500")}
        />
      ) : (
        <VideoSurface
          face={tile.face}
          className={cn(
            "absolute inset-0 h-full w-full",
            tile.face.kind === "screen" ? "bg-black object-contain" : "object-cover",
          )}
        />
      )}

      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-background/80 px-1.5 py-0.5 text-xs backdrop-blur-sm">
        {tile.name}
        {tile.isSelf && <span className="text-muted-foreground">(you)</span>}
        {tile.selfDeaf ? (
          <HeadphoneOffIcon className="size-3 text-red-500" />
        ) : tile.selfMute ? (
          <MicOffIcon className="size-3 text-red-500" />
        ) : null}
      </span>

      {tile.live && (
        <span className="absolute top-1.5 left-1.5 bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          LIVE
        </span>
      )}
    </PeerVolumeMenu>
  );
}
