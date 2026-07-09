import { Outlet, createFileRoute } from "@tanstack/react-router";

// The DM sidebar lives in the app shell (AppSidebar); this layout is a pass-through.
export const Route = createFileRoute("/(app)/dms")({
  component: () => <Outlet />,
});
