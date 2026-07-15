import { hasPermission, PERMISSIONS } from "@konus-la/api/permissions";
import { ContextMenuItem, ContextMenuSeparator } from "@konus-la/ui/components/context-menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GavelIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

/**
 * The viewer's kick/ban verbs against one guild, permission-gated only — hierarchy stays
 * server-side, so an out-of-rank attempt surfaces as the server's FORBIDDEN toast
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

  return {
    canKick: hasPermission(permissions, PERMISSIONS.KICK_MEMBERS),
    canBan: hasPermission(permissions, PERMISSIONS.BAN_MEMBERS),
    kick,
    ban,
  };
}

/**
 * Kick/ban items for a member-targeting context menu, each shown only with its
 * permission. Renders nothing when the viewer holds neither bit; `leadingSeparator`
 * divides them from a host menu's existing groups (the per-peer volume menu).
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
  const { canKick, canBan, kick, ban } = useMemberModeration(guildId);
  if (!canKick && !canBan) return null;

  return (
    <>
      {leadingSeparator && <ContextMenuSeparator />}
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
