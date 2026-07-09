import type { AppRouterClient } from "@konus-la/api/routers/index";
import type { QueryClient } from "@tanstack/react-query";

import type { DmListItem } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

export type DmConversation = Awaited<ReturnType<AppRouterClient["dm"]["get"]>>;

type Participant = DmListItem["participants"][number];

/** The other side of a 1:1 — undefined on malformed rows (defensive, never expected). */
export function dmOtherParticipant(
  row: Pick<DmListItem, "participants">,
  selfUserId: string,
): Participant | undefined {
  return row.participants.find((p) => p.userId !== selfUserId);
}

/**
 * What a conversation is called in lists and headers: a group's explicit name, else the
 * other participants' display names ("Alice, Bob"), else the 1:1 partner's name.
 */
export function dmDisplayName(
  row: Pick<DmListItem, "isGroup" | "name" | "participants">,
  selfUserId: string,
): string {
  if (row.isGroup && row.name) return row.name;
  const others = row.participants.filter((p) => p.userId !== selfUserId);
  if (others.length === 0) return "Just you";
  return others.map((p) => p.displayName || p.username).join(", ");
}

/** The viewer's existing 1:1 with `userId`, if the dm.list rows already carry one. */
export function findDmWith(
  rows: DmListItem[] | undefined,
  userId: string,
): DmListItem | undefined {
  return rows?.find((row) => !row.isGroup && row.participants.some((p) => p.userId === userId));
}

/** Refresh both caches a conversation lives in: the dm.list sidebar and its dm.get roster. */
export function invalidateDmConversation(client: QueryClient, channelId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: orpc.dm.list.key() }),
    client.invalidateQueries({ queryKey: orpc.dm.get.key({ input: { channelId } }) }),
  ]);
}
