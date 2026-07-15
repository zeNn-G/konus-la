import { hasPermission, PERMISSIONS } from "@konus-la/api/permissions";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@konus-la/ui/components/empty";
import { SidebarTrigger } from "@konus-la/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { HashIcon } from "lucide-react";
import { useEffect } from "react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/guilds/$guildId/")({
  // A guild's home is its first channel; this page only renders when there are none.
  beforeLoad: async ({ context, params }) => {
    const channels = await context.queryClient.ensureQueryData(
      orpc.channel.list.queryOptions({ input: { guildId: params.guildId } }),
    );
    if (channels[0]) {
      throw redirect({
        to: "/guilds/$guildId/channels/$channelId",
        params: { guildId: params.guildId, channelId: channels[0].id },
        replace: true,
      });
    }
  },
  component: NoChannelsPane,
});

function NoChannelsPane() {
  const { guildId } = Route.useParams();
  const navigate = useNavigate();
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));
  const channels = useQuery(orpc.channel.list.queryOptions({ input: { guildId } }));

  // beforeLoad won't re-run while parked here — enter the first channel the moment one
  // arrives (realtime channel.created invalidates channel.list).
  const firstChannelId = channels.data?.[0]?.id;
  useEffect(() => {
    if (firstChannelId) {
      void navigate({
        to: "/guilds/$guildId/channels/$channelId",
        params: { guildId, channelId: firstChannelId },
        replace: true,
      });
    }
  }, [firstChannelId, guildId, navigate]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2 md:px-4 md:py-2.5">
        <SidebarTrigger className="md:hidden" />
        <h1 className="truncate text-sm font-medium">{guild.data?.guild.name}</h1>
      </header>

      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HashIcon />
          </EmptyMedia>
          <EmptyTitle>No channels yet</EmptyTitle>
          <EmptyDescription>
            {hasPermission(guild.data?.viewer.permissions ?? 0, PERMISSIONS.MANAGE_CHANNELS)
              ? "Create the first channel from the sidebar."
              : "No one has created any channels yet."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
