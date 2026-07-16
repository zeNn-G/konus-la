import { hasPermission, PERMISSIONS } from "@konus-la/api/permissions";
import { ContextMenuItem, ContextMenuSeparator } from "@konus-la/ui/components/context-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { GavelIcon, MicIcon, MicOffIcon, PhoneOffIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";

import { useGuildVoiceSeat } from "@/lib/voice/occupancy";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * The viewer's moderation verbs against one guild, permission-gated only — hierarchy
 * stays server-side, so an out-of-rank attempt surfaces as the server's FORBIDDEN toast
 * (spec #47: no hierarchy-aware greying in v1).
 */
export function useMemberModeration(guildId: string) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const permissions = guild.data?.viewer.permissions ?? 0;
  const guildKey = orpc.guild.get.queryOptions({ input: { guildId } }).queryKey;
  const bansKey = orpc.guild.member.banList.queryOptions({ input: { guildId } }).queryKey;

  const kick = useMutation(
    orpc.guild.member.kick.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: guildKey });
        toast.success("Member removed.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const ban = useMutation(
    orpc.guild.member.ban.mutationOptions({
      onSuccess: async () => {
        // A ban changes both lists: the roster loses the member, the ban list gains them.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: guildKey }),
          queryClient.invalidateQueries({ queryKey: bansKey }),
        ]);
        toast.success("Member banned.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const serverMute = useMutation(
    orpc.mod.serverMute.mutationOptions({
      onSuccess: async (_data, input) => {
        // The seated badge patches off voice.serverMuteSet; the roster row needs the read.
        await queryClient.invalidateQueries({ queryKey: guildKey });
        toast.success(input.muted ? "Member server-muted." : "Server mute removed.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const disconnectVoice = useMutation(
    orpc.mod.disconnectVoice.mutationOptions({
      // Occupancy reconciles off the peerLeft fan-out — nothing to invalidate.
      onSuccess: () => toast.success("Member disconnected from voice."),
      onError: (error) => toast.error(error.message),
    }),
  );

  return {
    canKick: hasPermission(permissions, PERMISSIONS.KICK_MEMBERS),
    canBan: hasPermission(permissions, PERMISSIONS.BAN_MEMBERS),
    canServerMute: hasPermission(permissions, PERMISSIONS.MUTE_MEMBERS),
    canDisconnectVoice: hasPermission(permissions, PERMISSIONS.MOVE_MEMBERS),
    kick,
    ban,
    serverMute,
    disconnectVoice,
  };
}

/**
 * Moderation items for a member-targeting context menu (spec §UI: server-mute /
 * disconnect / kick / ban), each shown only with its permission. Self and the owner are
 * never offered, and Disconnect only appears while the target actually holds a seat in
 * this guild — statically invalid targets, not hierarchy-aware greying (rank misses
 * still surface as the server's FORBIDDEN). Renders nothing when no item survives;
 * `leadingSeparator` divides the items from a host menu's existing groups (the per-peer
 * volume menu).
 */
export function MemberModerationItems({
  guildId,
  userId,
  leadingSeparator = false,
}: {
  guildId: string;
  userId: string;
  leadingSeparator?: boolean;
}) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const { session } = getRouteApi("/(app)").useRouteContext();
  const { canKick, canBan, canServerMute, canDisconnectVoice, kick, ban, serverMute, disconnectVoice } =
    useMemberModeration(guildId);
  // Seated users patch live off voice.serverMuteSet; the roster row covers the rest.
  const seat = useGuildVoiceSeat(guildId, userId);
  const targetServerMuted =
    seat?.serverMuted ??
    guild.data?.members.find((member) => member.userId === userId)?.serverMuted ??
    false;
  if (!canKick && !canBan && !canServerMute && !canDisconnectVoice) return null;
  if (userId === session.user.id || userId === guild.data?.guild.ownerId) return null;

  return (
    <>
      {leadingSeparator && <ContextMenuSeparator />}
      {canServerMute && (
        <ContextMenuItem
          onClick={() => serverMute.mutate({ guildId, userId, muted: !targetServerMuted })}
        >
          {targetServerMuted ? <MicIcon /> : <MicOffIcon />}
          {targetServerMuted ? "Server unmute" : "Server mute"}
        </ContextMenuItem>
      )}
      {canDisconnectVoice && seat !== undefined && (
        <ContextMenuItem onClick={() => disconnectVoice.mutate({ guildId, userId })}>
          <PhoneOffIcon />
          Disconnect from voice
        </ContextMenuItem>
      )}
      {canKick && (
        <ContextMenuItem onClick={() => kick.mutate({ guildId, userId })}>
          <UserXIcon />
          Kick
        </ContextMenuItem>
      )}
      {canBan && (
        <ContextMenuItem variant="destructive" onClick={() => ban.mutate({ guildId, userId })}>
          <GavelIcon />
          Ban
        </ContextMenuItem>
      )}
    </>
  );
}
