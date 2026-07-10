import { useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { guildEvictedKey } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

// The channel sidebar lives in the app shell (AppSidebar); this layout only enforces
// eviction when the dispatcher raises the tombstone (kicked / banned / left).
export const Route = createFileRoute("/(app)/guilds/$guildId")({
  component: GuildLayout,
});

function GuildLayout() {
  const { guildId } = Route.useParams();
  const navigate = useNavigate();

  const evicted = useQuery({
    queryKey: guildEvictedKey(guildId),
    queryFn: () => false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  // Leave first, clean after: refetching guild.get/channel.list while still mounted
  // would come back FORBIDDEN and toast (same discipline as DM eviction).
  useEffect(() => {
    if (!evicted.data) return;
    void navigate({ to: "/" }).then(() => {
      queryClient.removeQueries({ queryKey: orpc.guild.get.key({ input: { guildId } }) });
      queryClient.removeQueries({ queryKey: orpc.channel.list.key({ input: { guildId } }) });
      queryClient.removeQueries({ queryKey: guildEvictedKey(guildId) });
    });
  }, [evicted.data, navigate, guildId]);

  return <Outlet />;
}
