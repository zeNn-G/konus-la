import { useEffect } from "react";

import {
  resolvePref,
  useNotificationPrefs,
  type NotificationPrefsSnapshot,
} from "@/lib/notification-prefs";
import { listCacheRows } from "@/lib/query-cache";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * The 7.7 static tab-title counter (#75): `(n) konus-la`, no flicker or alternation.
 * `n` is derived from the same query caches that render the sidebar badges — never
 * counted separately — so mark-read and cross-tab `readState.updated` patches reset it
 * for free.
 */

const BASE_TITLE = "konus-la";

/** The badge fields of a `channel.list` / `dm.list` row — what the derivation reads. */
type GuildChannelRow = { id: string; mentionsCount: number };
type DmRow = { id: string; unread: boolean };

export function tabTitleCount(
  guildChannels: GuildChannelRow[],
  dmRows: DmRow[],
  prefs: NotificationPrefsSnapshot,
): number {
  // Mute silences the contribution; the sidebar's unread bold / mention badge stays
  // (#76 — mute is about interruptions, not information).
  const guildMentions = guildChannels.reduce(
    (sum, channel) =>
      resolvePref(prefs, channel.id, "guild") === "muted" ? sum : sum + channel.mentionsCount,
    0,
  );
  // A DM conversation counts once while unread, however many messages or mentions it holds.
  const unreadDms = dmRows.filter(
    (row) => row.unread && resolvePref(prefs, row.id, "dm") !== "muted",
  ).length;
  return guildMentions + unreadDms;
}

export function formatTabTitle(count: number): string {
  return count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
}

/**
 * Mount ONCE in the authenticated layout. Recomputes on every query-cache or prefs
 * notification; the title is static — it only ever changes when `n` does, never
 * alternating.
 */
export function useTabTitle(): void {
  useEffect(() => {
    let last: string | null = null;
    const apply = () => {
      const title = formatTabTitle(
        tabTitleCount(
          listCacheRows<GuildChannelRow>(queryClient, orpc.channel.list.key()),
          listCacheRows<DmRow>(queryClient, orpc.dm.list.key()),
          useNotificationPrefs.getState(),
        ),
      );
      if (title === last) return;
      last = title;
      document.title = title;
    };
    apply();
    const unsubscribeCache = queryClient.getQueryCache().subscribe(apply);
    const unsubscribePrefs = useNotificationPrefs.subscribe(apply);
    return () => {
      unsubscribeCache();
      unsubscribePrefs();
      document.title = BASE_TITLE;
    };
  }, []);
}
