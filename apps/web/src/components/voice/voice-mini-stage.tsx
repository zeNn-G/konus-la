import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { cn } from "@konus-la/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Maximize2Icon } from "lucide-react";

import { useVoiceStore } from "@/lib/voice/store";
import { deriveMiniStage } from "@/lib/voice/ui-model";
import { orpc } from "@/utils/orpc";

import { useRoomTiles } from "./use-voice-room";

import { VideoSurface } from "./video-surface";

/**
 * Corner card shown in the chat pane while connected to voice but browsing a text
 * channel (decision #10 variant B): screenshare if any, else the active speaker, plus a
 * facepile. Expanding navigates back to the voice channel — the full room, not an overlay.
 * Must sit inside a `relative` chat column.
 */
export function VoiceMiniStage() {
  const navigate = useNavigate();
  const status = useVoiceStore((s) => s.status);
  const guildId = useVoiceStore((s) => s.guildId);
  const channelId = useVoiceStore((s) => s.channelId);

  const { tiles } = useRoomTiles(guildId, channelId);
  const channels = useQuery({
    ...orpc.channel.list.queryOptions({ input: { guildId: guildId ?? "" } }),
    enabled: guildId !== null,
  });

  if (status === "idle" || guildId === null || channelId === null) return null;

  const stage = deriveMiniStage(tiles);
  if (!stage) return null;

  const channelName = channels.data?.find((c) => c.id === channelId)?.name ?? "";
  const expand = () =>
    void navigate({
      to: "/guilds/$guildId/channels/$channelId",
      params: { guildId, channelId },
    });

  return (
    <div className="absolute right-3 bottom-24 z-30 flex w-56 flex-col bg-background shadow-lg ring-1 ring-foreground/10">
      <div className="relative h-32 overflow-hidden">
        {stage.preview.face.kind === "avatar" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
            <Avatar
              seed={stage.preview.seed}
              src={stage.preview.image}
              className={cn(
                "size-12 ring-2 ring-transparent",
                stage.preview.speaking && "ring-green-500",
              )}
            />
          </div>
        ) : (
          <VideoSurface
            face={stage.preview.face}
            className={cn(
              "absolute inset-0 h-full w-full",
              stage.preview.face.kind === "screen" ? "bg-black object-contain" : "object-cover",
            )}
          />
        )}
        <span className="absolute bottom-1 left-1 bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur-sm">
          {stage.label}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open voice room"
          title="Open voice room"
          className="absolute top-1 right-1 bg-background/80 backdrop-blur-sm"
          onClick={expand}
        >
          <Maximize2Icon className="size-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5">
        {stage.facepile.map((tile) => (
          <Avatar
            key={tile.userId}
            seed={tile.seed}
            src={tile.image}
            className={cn("size-5 ring-1 ring-transparent", tile.speaking && "ring-green-500")}
          />
        ))}
        <span className="ml-auto truncate pl-1 text-[10px] text-green-500">{channelName}</span>
      </div>
    </div>
  );
}
