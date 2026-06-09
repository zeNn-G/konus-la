import { Outlet, createFileRoute } from "@tanstack/react-router";

import { requireAdmin } from "@/lib/auth-guard";

/**
 * Admin layout. Nested under the app layout, so the session is already resolved; this only
 * adds the Instance-Owner (`role: 'admin'`) gate for everything under `/admin`.
 */
export const Route = createFileRoute("/(app)/admin")({
  beforeLoad: async () => {
    await requireAdmin();
  },
  component: () => <Outlet />,
});
