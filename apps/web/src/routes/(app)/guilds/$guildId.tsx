import { GuildIcon } from "@konus-la/ui/components/guild-icon";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/guilds/$guildId")({
  component: GuildView,
});

function GuildView() {
  const { guildId } = Route.useParams();
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));

  if (guild.isPending) {
    return <div className="px-4 py-8 text-muted-foreground">Loading…</div>;
  }
  if (!guild.data) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-3">
        <GuildIcon
          seed={guild.data.guild.id}
          src={guild.data.guild.icon}
          alt={guild.data.guild.name}
          className="size-12"
        />
        <h1 className="text-lg font-medium">{guild.data.guild.name}</h1>
      </div>
    </div>
  );
}
