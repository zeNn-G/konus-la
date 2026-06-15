import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { GuildIcon } from "@konus-la/ui/components/guild-icon";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/guilds/$guildId/")({
  component: GuildView,
});

function GuildView() {
  const { guildId } = Route.useParams();
  const guild = useQuery(orpc.guild.get.queryOptions({ input: { guildId } }));

  if (guild.isPending) {
    return <div className="px-4 py-8 text-muted-foreground">Loading…</div>;
  }
  if (!guild.data) return null;

  const { guild: g, members, viewer } = guild.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-3">
        <GuildIcon seed={g.id} src={g.icon} alt={g.name} className="size-12" />
        <h1 className="text-lg font-medium">{g.name}</h1>
        {viewer.isOwner && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Guild settings"
            render={<Link to="/guilds/$guildId/settings" params={{ guildId }} />}
          >
            <SettingsIcon />
          </Button>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-medium text-muted-foreground">Members — {members.length}</h2>
        <ul className="mt-2 flex flex-col divide-y divide-foreground/10">
          {members.map((m) => {
            const isOwner = m.userId === g.ownerId;
            return (
              <li key={m.userId} className="flex items-center gap-3 py-2">
                <Avatar seed={m.username ?? m.userId} src={m.image} className="size-7" />
                <span className="text-sm">{m.displayName || m.username || m.userId}</span>
                {m.username && <span className="text-xs text-muted-foreground">@{m.username}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {isOwner ? "Owner" : "@everyone"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
