import type { AppRouterClient } from "@konus-la/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { serverOrigin } from "@/lib/server-url";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Freshness is realtime-driven: the dispatcher patches message/read-state caches
      // directly and invalidates on structural events + reconnect, so remounting a view
      // within this window must not refetch (every sidebar/guild navigation was firing
      // list/get requests for data the socket already keeps current).
      staleTime: 30_000,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(`Error: ${error.message}`, {
        action: {
          label: "retry",
          onClick: query.invalidate,
        },
      });
    },
  }),
});

export const link = new RPCLink({
  url: `${serverOrigin}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

// Dev-only: programmatic cache access for acceptance harnesses (voice occupancy keys).
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__queryClient = queryClient;
}
