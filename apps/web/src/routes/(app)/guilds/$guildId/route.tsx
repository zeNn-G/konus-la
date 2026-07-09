import { Outlet, createFileRoute } from "@tanstack/react-router";

// The channel sidebar lives in the app shell (AppSidebar); this layout is a pass-through.
export const Route = createFileRoute("/(app)/guilds/$guildId")({
  component: () => <Outlet />,
});
