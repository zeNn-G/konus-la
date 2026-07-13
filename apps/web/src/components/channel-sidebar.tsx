import { Button } from "@konus-la/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@konus-la/ui/components/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@konus-la/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@konus-la/ui/components/sidebar";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, HashIcon, MoreVerticalIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ChannelNameDialog,
  channelLabel,
  type ChannelKind,
} from "@/components/channel-name-dialog";
import { GuildSettingsDialog } from "@/components/guild-settings/guild-settings-dialog";
import { UserCard } from "@/components/user-card";
import { ControlDeck } from "@/components/voice/control-deck";
import { VoiceChannelRows } from "@/components/voice/voice-channel-rows";
import type { ChannelListItem } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * Per-guild channel rail: `channel.list` rows with unread bold + mention badge, owner-only
 * create / rename / delete. Live updates arrive via the realtime dispatcher (setQueryData
 * for read-state, invalidation for structural changes) — no polling.
 */
export function ChannelSidebar({ guildId }: { guildId: string }) {
  const channels = useQuery(orpc.channel.list.queryOptions({ input: { guildId } }));
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const isOwner = guild.data?.viewer.isOwner ?? false;

  const textChannels = channels.data?.filter((channel) => channel.kind !== "voice") ?? [];
  const voiceChannels = channels.data?.filter((channel) => channel.kind === "voice") ?? [];

  const navigate = useNavigate();
  /** The kind the create dialog is minting; null when closed. Each "+" sets its own. */
  const [createKind, setCreateKind] = useState<ChannelKind | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChannelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelListItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const leaveGuild = useMutation(
    orpc.guild.member.leave.mutationOptions({
      onSuccess: async () => {
        // Leave the guild's routes before invalidating — a refetch from inside would 403.
        setLeaveOpen(false);
        await navigate({ to: "/" });
        await queryClient.invalidateQueries({ queryKey: orpc.guild.list.queryOptions().queryKey });
        toast.success("Left guild.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const deleteChannel = useMutation(
    orpc.channel.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.channel.list.key() });
        setDeleteTarget(null);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Sidebar collapsible="none" className="min-w-0 flex-1">
      <SidebarHeader className="gap-0 border-b border-sidebar-border p-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
              />
            }
          >
            {guild.data ? (
              <span className="truncate">{guild.data.guild.name}</span>
            ) : (
              <Skeleton className="my-0.5 h-4 w-24" />
            )}
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {isOwner ? (
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                Guild settings
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => setLeaveOpen(true)}>
                Leave guild
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent>
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-xs font-medium text-muted-foreground">Channels</span>
          {isOwner && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Create text channel"
              title="Create text channel"
              onClick={() => setCreateKind("text")}
            >
              <PlusIcon className="size-4" />
            </Button>
          )}
        </div>

        <nav className="flex flex-col gap-0.5 px-2 pb-2">
          {channels.isPending &&
            Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          {textChannels.map((channel) => (
            // Named group: the shell's <Sidebar> root is itself a bare `group`, so an
            // unnamed group-hover here would reveal every row's kebab at once.
            <div key={channel.id} className="group/channel relative">
              <Link
                to="/guilds/$guildId/channels/$channelId"
                params={{ guildId, channelId: channel.id }}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  channel.unread && "font-semibold text-foreground",
                )}
                activeProps={{ className: "bg-muted text-foreground" }}
              >
                <HashIcon className="size-4 shrink-0 opacity-60" />
                <span className="truncate">{channel.name}</span>
                {channel.mentionsCount > 0 && (
                  <span
                    className={cn(
                      "ml-auto rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white",
                      // Owners get a kebab in the same spot on hover — the badge yields to it.
                      isOwner &&
                        "group-hover/channel:hidden group-has-data-popup-open/channel:hidden",
                    )}
                  >
                    {channel.mentionsCount}
                  </span>
                )}
              </Link>

              {isOwner && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Channel options for #${channel.name}`}
                        className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/channel:opacity-100 data-popup-open:opacity-100"
                      />
                    }
                  >
                    <MoreVerticalIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setRenameTarget(channel)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteTarget(channel)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </nav>

        {/* An owner with no voice channels still gets the header — its "+" is the only way to
            make the first one, which is exactly when discovery matters. Members see nothing. */}
        {(isOwner || voiceChannels.length > 0) && (
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-xs font-medium text-muted-foreground">Voice</span>
            {isOwner && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Create voice channel"
                title="Create voice channel"
                onClick={() => setCreateKind("voice")}
              >
                <PlusIcon className="size-4" />
              </Button>
            )}
          </div>
        )}

        <VoiceChannelRows
          guildId={guildId}
          channels={voiceChannels}
          actions={isOwner ? { onRename: setRenameTarget, onDelete: setDeleteTarget } : undefined}
        />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <ControlDeck />
        <UserCard />
      </SidebarFooter>

      {/* Kept inside the sidebar (not the mobile sheet's siblings): Base UI stacks nested
          dialogs over the sheet via context, and closing the sheet would unmount them. */}
      <GuildSettingsDialog guildId={guildId} open={settingsOpen} onOpenChange={setSettingsOpen} />

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {guild.data?.guild.name ?? "this guild"}?</AlertDialogTitle>
            <AlertDialogDescription>You’ll need a new invite to rejoin.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={leaveGuild.isPending}
              onClick={() => leaveGuild.mutate({ guildId })}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {createKind && (
        <ChannelNameDialog
          key={createKind}
          guildId={guildId}
          kind={createKind}
          open
          onOpenChange={(open) => !open && setCreateKind(null)}
        />
      )}
      {renameTarget && (
        <ChannelNameDialog
          key={renameTarget.id}
          guildId={guildId}
          channel={renameTarget}
          open
          onOpenChange={(open) => !open && setRenameTarget(null)}
        />
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget ? channelLabel(deleteTarget) : "channel"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "voice"
                ? "The channel disappears for everyone in this guild. There is no undo."
                : "Every message in this channel is deleted with it. There is no undo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteChannel.mutate({ guildId, channelId: deleteTarget.id });
                }
              }}
            >
              Delete channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}
