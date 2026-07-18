import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** All rows across a (possibly partial-key-matched) family of list caches. */
export function listCacheRows<T>(client: QueryClient, queryKey: QueryKey): T[] {
  return client.getQueriesData<T[]>({ queryKey }).flatMap(([, rows]) => rows ?? []);
}
