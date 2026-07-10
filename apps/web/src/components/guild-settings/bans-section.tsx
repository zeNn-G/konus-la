import { Button } from "@konus-la/ui/components/button";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

export function BansSection({ guildId }: { guildId: string }) {
  const bans = useQuery(orpc.guild.member.banList.queryOptions({ input: { guildId } }));
  const bansKey = orpc.guild.member.banList.queryOptions({ input: { guildId } }).queryKey;

  const unban = useMutation(
    orpc.guild.member.unban.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: bansKey });
        toast.success("Ban lifted.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (bans.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (!bans.data) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Banned users can’t rejoin, even with a valid invite, until unbanned.
      </p>
      {bans.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-foreground/10">
          {bans.data.map((b) => (
            <li key={b.userId} className="flex items-center gap-3 py-2">
              <span className="text-sm">{b.displayName || b.username || b.userId}</span>
              {b.username && <span className="text-xs text-muted-foreground">@{b.username}</span>}
              <span className="text-xs text-muted-foreground">
                banned {b.createdAt.toLocaleDateString()}
                {b.reason ? ` · ${b.reason}` : ""}
              </span>
              <Button
                size="xs"
                variant="outline"
                className="ml-auto"
                disabled={unban.isPending}
                onClick={() => unban.mutate({ guildId, userId: b.userId })}
              >
                Unban
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No bans.</p>
      )}
    </div>
  );
}
