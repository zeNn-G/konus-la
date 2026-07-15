import { Button } from "@konus-la/ui/components/button";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { MemberRoleChips } from "@/components/guild-settings/roles-prototype/member-role-chips";
import { seedAssignments } from "@/components/guild-settings/roles-prototype/store";
import { useRolesVariant } from "@/components/guild-settings/roles-prototype/use-variant";
import { orpc, queryClient } from "@/utils/orpc";

export function MembersSection({ guildId }: { guildId: string }) {
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));

  // PROTOTYPE (wayfinder #48): give the in-memory role store real member ids once.
  const variant = useRolesVariant();
  useEffect(() => {
    if (variant && guild.data) {
      seedAssignments(
        guild.data.members.map((m) => m.userId),
        guild.data.guild.ownerId,
      );
    }
  }, [variant, guild.data]);
  const guildKey = orpc.guild.get.queryOptions({ input: { guildId } }).queryKey;
  const bansKey = orpc.guild.member.banList.queryOptions({ input: { guildId } }).queryKey;
  const invalidateGuild = () => queryClient.invalidateQueries({ queryKey: guildKey });

  const kick = useMutation(
    orpc.guild.member.kick.mutationOptions({
      onSuccess: async () => {
        await invalidateGuild();
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
          invalidateGuild(),
          queryClient.invalidateQueries({ queryKey: bansKey }),
        ]);
        toast.success("Member banned.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (guild.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!guild.data) return null;

  const { guild: g, members } = guild.data;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Remove or ban members. You can’t target yourself.
      </p>
      <ul className="flex flex-col divide-y divide-foreground/10">
        {members.map((m) => {
          const isGuildOwner = m.userId === g.ownerId;
          return (
            <li key={m.userId} className="flex items-center gap-3 py-2">
              <span className="text-sm">{m.displayName || m.username || m.userId}</span>
              {m.username && <span className="text-xs text-muted-foreground">@{m.username}</span>}
              {variant ? (
                <MemberRoleChips userId={m.userId} isOwner={isGuildOwner} />
              ) : (
                <span className="ml-auto text-xs text-muted-foreground">
                  {isGuildOwner ? "Owner" : "@everyone"}
                </span>
              )}
              {!isGuildOwner && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={kick.isPending}
                    onClick={() => kick.mutate({ guildId, userId: m.userId })}
                  >
                    Kick
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={ban.isPending}
                    onClick={() => ban.mutate({ guildId, userId: m.userId })}
                  >
                    Ban
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
