import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { UserCard } from "@/components/user-card";
import { requireSession } from "@/lib/auth-guard";

/**
 * Authenticated app layout. Guards every route under `(app)` once (no per-route guard)
 * and renders the shared shell. The session it resolves flows into child route context.
 */
export const Route = createFileRoute("/(app)")({
  beforeLoad: async () => ({
    session: await requireSession(),
  }),
  component: AppLayout,
});

function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <Link to="/" className="text-sm font-medium">
            konus-la
          </Link>
          <UserCard />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
