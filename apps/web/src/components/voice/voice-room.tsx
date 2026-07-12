import { Button } from "@konus-la/ui/components/button";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { PhoneIcon, Volume2Icon } from "lucide-react";

import { voiceSession } from "@/lib/voice/session";
import { useVoiceStore } from "@/lib/voice/store";

import { ControlCapsule } from "./control-capsule";
import { RoomTile } from "./room-tile";
import { useRoomTiles } from "./use-voice-room";

/**
 * Channel-pane takeover for a voice channel (decision #10 variant A): tile grid plus
 * the bottom control capsule. Rendered whenever the route's channel is `kind: "voice"` —
 * seated or not; un-seated visitors get an occupancy preview and a join capsule.
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
  // The join button and the capsule share the same centered slot. Swapping the live
  // capsule in while the join click is still settling lets the tail of that click land
  // on a control button (observed: instant self-mute) — so during "joining" the slot
  // holds a disabled placeholder instead.
  const joining = connectedHere && status === "joining";

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

      <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-3 overflow-y-auto p-4">
        {tiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">It’s quiet in here.</p>
        ) : (
          tiles.map((tile) => <RoomTile key={tile.userId} tile={tile} />)
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
