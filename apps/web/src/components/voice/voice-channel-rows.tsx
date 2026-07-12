import { Avatar } from "@konus-la/ui/components/avatar";
import { cn } from "@konus-la/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { HeadphoneOffIcon, MicOffIcon, Volume2Icon } from "lucide-react";

import { voiceSession } from "@/lib/voice/session";
import type { RoomTileModel } from "@/lib/voice/ui-model";
import type { ChannelListItem } from "@/lib/use-realtime";

import { PeerVolumeMenu } from "./peer-volume-menu";
import { useRoomTiles } from "./use-voice-room";

/**
 * The sidebar's voice section (decision #10 variant A): one row per voice channel with
 * the occupant list nested beneath it, live off the tier-1 occupancy key. Clicking a
 * row joins and opens the room — join is idempotent, so re-clicking your own channel
 * just re-enters the pane.
 */
export function VoiceChannelRows({
  guildId,
  channels,
}: {
  guildId: string;
  channels: ChannelListItem[];
}) {
  if (channels.length === 0) return null;

  return (
    <div className="flex flex-col px-2 pb-2">
      <span className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">Voice</span>
      {channels.map((channel) => (
        <VoiceChannelRow key={channel.id} guildId={guildId} channel={channel} />
      ))}
    </div>
  );
}

function VoiceChannelRow({ guildId, channel }: { guildId: string; channel: ChannelListItem }) {
  const { tiles } = useRoomTiles(guildId, channel.id);

  return (
    <div className="flex flex-col">
      <Link
        to="/guilds/$guildId/channels/$channelId"
        params={{ guildId, channelId: channel.id }}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        activeProps={{ className: "bg-muted text-foreground" }}
        onClick={() => void voiceSession.join({ channelId: channel.id, guildId })}
      >
        <Volume2Icon className="size-4 shrink-0 opacity-60" />
        <span className="truncate">{channel.name}</span>
      </Link>
      {tiles.map((tile) => (
        <OccupantRow key={tile.userId} tile={tile} />
      ))}
    </div>
  );
}

/** One seated user under a voice row: speaking ring, mute/deafen badge, volume menu. */
function OccupantRow({ tile }: { tile: RoomTileModel }) {
  return (
    <PeerVolumeMenu
      userId={tile.userId}
      name={tile.name}
      enabled={!tile.isSelf}
      render={
        <div className="flex items-center gap-1.5 py-0.5 pr-2 pl-7 text-xs text-muted-foreground" />
      }
    >
      <Avatar
        seed={tile.seed}
        src={tile.image}
        className={cn("size-4.5 ring-1 ring-transparent", tile.speaking && "ring-green-500")}
      />
      <span className={cn("truncate", tile.speaking && "text-foreground")}>{tile.name}</span>
      {tile.selfDeaf ? (
        <HeadphoneOffIcon className="ml-auto size-3 shrink-0 text-red-500/80" />
      ) : tile.selfMute ? (
        <MicOffIcon className="ml-auto size-3 shrink-0 text-red-500/80" />
      ) : null}
    </PeerVolumeMenu>
  );
}
