import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ChannelSidebar } from "@/components/channel-sidebar";

export const Route = createFileRoute("/(app)/guilds/$guildId")({
  component: GuildLayout,
});

function GuildLayout() {
  const { guildId } = Route.useParams();
  return (
    <div className="flex h-full min-h-0">
      <ChannelSidebar guildId={guildId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
