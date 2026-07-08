import { Outlet, createFileRoute } from "@tanstack/react-router";

import { DmSidebar } from "@/components/dm/dm-sidebar";

export const Route = createFileRoute("/(app)/dms")({
  component: DmsLayout,
});

function DmsLayout() {
  const { session } = Route.useRouteContext();
  return (
    <div className="flex h-full min-h-0">
      <DmSidebar selfUserId={session.user.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
