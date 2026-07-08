import { useQuery } from "@tanstack/react-query";

import type { UserSearchResult } from "@/lib/use-user-search";
import { orpc } from "@/utils/orpc";

/**
 * People the viewer already talks to, newest conversation first: `dm.list` participants
 * flattened, self excluded, deduped. Shaped like search results so pickers render recents
 * and matches with the same rows. Uncapped — pickers slice after their own exclusions.
 *
 * `excludeExistingDms` leaves out anyone who already has a 1:1 in the sidebar (the New DM
 * picker offers new faces from groups instead of duplicating existing conversations).
 */
export function useRecentContacts(
  selfUserId: string,
  { excludeExistingDms = false }: { excludeExistingDms?: boolean } = {},
): UserSearchResult[] {
  const dms = useQuery(orpc.dm.list.queryOptions());

  const rows = [...(dms.data ?? [])].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const skip = new Set<string>([selfUserId]);
  if (excludeExistingDms) {
    for (const row of rows) {
      if (row.isGroup) continue;
      for (const participant of row.participants) skip.add(participant.userId);
    }
  }

  const recents: UserSearchResult[] = [];
  for (const row of rows) {
    for (const participant of row.participants) {
      if (skip.has(participant.userId)) continue;
      skip.add(participant.userId);
      recents.push({
        id: participant.userId,
        username: participant.username,
        displayName: participant.displayName,
        image: participant.image,
      });
    }
  }
  return recents;
}
