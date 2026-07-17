import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { authClient } from "./auth-client";

/**
 * The current session, read through the query cache: hover preloads re-run route
 * `beforeLoad` unconditionally (router-core runs it even for already-active layout
 * matches; `defaultPreloadStaleTime` only gates loaders), so guards share this one entry
 * instead of firing a /get-session request per hover. Past the 30s
 * window the next guard refetches, so server-side changes (expiry, revocation, role) still
 * surface. Auth transitions always re-check live: sign-in clears the query cache and
 * sign-out hard-reloads the app, so neither can leave a stale session behind.
 */
const sessionQuery = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: async () => (await authClient.getSession()).data,
  staleTime: 30_000,
});

/** beforeLoad guard: require an authenticated session or bounce to /login. */
export async function requireSession(queryClient: QueryClient) {
  const data = await queryClient.fetchQuery(sessionQuery);
  if (!data?.user) {
    throw redirect({ to: "/login" });
  }
  return data;
}
