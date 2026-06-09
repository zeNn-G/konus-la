import { redirect } from "@tanstack/react-router";

import { authClient } from "./auth-client";

/**
 * beforeLoad guard: require an authenticated session or bounce to /login.
 *
 * Guards live on the `(app)` / `(app)/admin` layouts, so TanStack Router's match caching
 * already de-dupes these calls across hover preloads — no client-side session cache needed.
 * Each fresh navigation (e.g. right after sign-in/out) re-runs this with a live `getSession`,
 * which is what keeps auth transitions correct.
 */
export async function requireSession() {
  const { data } = await authClient.getSession();
  if (!data?.user) {
    throw redirect({ to: "/login" });
  }
  return data;
}

/** beforeLoad guard: require the Instance Owner (global `admin` role) or bounce home. */
export async function requireAdmin() {
  const data = await requireSession();
  if (data.user.role !== "admin") {
    throw redirect({ to: "/" });
  }
  return data;
}
