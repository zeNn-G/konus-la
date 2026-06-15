import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/guilds/$guildId")({
  component: () => <Outlet />,
});
