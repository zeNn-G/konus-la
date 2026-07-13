import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@konus-la/ui/components/dropdown-menu";
import { cn } from "@konus-la/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { HeadphoneOffIcon, MicOffIcon, MoreVerticalIcon, Volume2Icon } from "lucide-react";

import { voiceSession } from "@/lib/voice/session";
import type { RoomTileModel } from "@/lib/voice/ui-model";
import type { ChannelListItem } from "@/lib/use-realtime";

import { PeerVolumeMenu } from "./peer-volume-menu";
import { useRoomTiles } from "./use-voice-room";

/** Owner rename/delete, lifted so the rows reuse ChannelSidebar's dialogs. */
export type VoiceChannelActions = {
  onRename: (channel: ChannelListItem) => void;
  onDelete: (channel: ChannelListItem) => void;
};

/**
 * The rows of the sidebar's voice section (decision #10 variant A): one row per voice
 * channel with the occupant list nested beneath it, live off the tier-1 occupancy key.
 * Clicking a row joins and opens the room — join is idempotent, so re-clicking your own
 * channel just re-enters the pane. The section header lives in ChannelSidebar, beside the
 * Channels one; this renders nothing when there are no voice channels.
 */
export function VoiceChannelRows({
  guildId,
  channels,
  actions,
}: {
  guildId: string;
  channels: ChannelListItem[];
  /** Present for guild owners only. */
  actions?: VoiceChannelActions;
}) {
  if (channels.length === 0) return null;

  return (
    <div className="flex flex-col px-2 pb-2">
      {channels.map((channel) => (
        <VoiceChannelRow key={channel.id} guildId={guildId} channel={channel} actions={actions} />
      ))}
    </div>
  );
}

function VoiceChannelRow({
  guildId,
  channel,
  actions,
}: {
  guildId: string;
  channel: ChannelListItem;
  actions?: VoiceChannelActions;
}) {
  const { tiles } = useRoomTiles(guildId, channel.id);

  return (
    <div className="flex flex-col">
      {/* Named group: the shell's <Sidebar> root is itself a bare `group`, so an unnamed
          group-hover here would reveal every row's kebab at once. */}
      <div className="group/channel relative">
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

        {actions && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Channel options for ${channel.name}`}
                  className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/channel:opacity-100 data-popup-open:opacity-100"
                />
              }
            >
              <MoreVerticalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => actions.onRename(channel)}>Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(channel)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
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
