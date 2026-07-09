import { useNavigate } from "@tanstack/react-router";

import { findDmWith } from "@/lib/dm";
import type { DmListItem } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * "Message this user": jump to the existing 1:1 when there is one, else to the draft view
 * (no channel is created until the first send). Shared by the new-DM picker and the
 * "Message" buttons on member lists.
 */
export function useMessageUser() {
  const navigate = useNavigate();

  return async (userId: string) => {
    const rows = await queryClient.ensureQueryData<DmListItem[]>(orpc.dm.list.queryOptions());
    const existing = findDmWith(rows, userId);
    if (existing) {
      await navigate({ to: "/dms/$channelId", params: { channelId: existing.id } });
    } else {
      await navigate({ to: "/dms/new/$userId", params: { userId } });
    }
  };
}
