import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { GuildRail } from "@/components/guild-rail";
import { UserCard } from "@/components/user-card";
import { requireSession } from "@/lib/auth-guard";
import { useRealtime } from "@/lib/use-realtime";

export const Route = createFileRoute("/(app)")({
  beforeLoad: async ({ context }) => ({
    session: await requireSession(context.queryClient),
  }),
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  useRealtime(session.user.id);
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-foreground/10">
        <div className="flex items-center justify-between px-4 py-2">
          <Link to="/" className="text-sm font-medium">
            konus-la
          </Link>
          <UserCard />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <GuildRail />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
