import type { AppRouterClient } from "@konus-la/api/routers/index";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@/utils/orpc";

const DEBOUNCE_MS = 250;

/** Mirrors the server-side default limit; a full page means results may be truncated. */
export const USER_SEARCH_LIMIT = 10;

export type UserSearchResult = Awaited<ReturnType<AppRouterClient["user"]["search"]>>[number];

export type UserSearch = {
  results: UserSearchResult[];
  /** Query typed but nothing to show yet (debounce gap or first fetch) → skeletons. */
  isSearching: boolean;
  /** Previous results still showing while a newer query settles → dim them. */
  isRefining: boolean;
  /** A full page came back; more matches may exist beyond the limit. */
  truncated: boolean;
};

/** Debounced `user.search` for the DM pickers. Empty query → no request, empty results. */
export function useUserSearch(query: string): UserSearch {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  const trimmed = debounced.trim();
  const search = useQuery(
    orpc.user.search.queryOptions({
      input: { query: trimmed, limit: USER_SEARCH_LIMIT },
      enabled: trimmed.length > 0,
      placeholderData: (previous) => previous,
    }),
  );

  const active = query.trim().length > 0;
  const hasData = trimmed.length > 0 && search.data !== undefined;
  const results = active && hasData ? (search.data ?? []) : [];

  return {
    results,
    isSearching: active && !hasData,
    isRefining: active && hasData && (trimmed !== query.trim() || search.isFetching),
    truncated: results.length === USER_SEARCH_LIMIT,
  };
}
