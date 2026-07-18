import { useEffect } from "react";

import { resolvePref, useNotificationPrefs } from "@/lib/notification-prefs";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * The 7.7 static tab-title counter (#75): `(n) konus-la`, no flicker or alternation.
 * `n` is derived from the same query caches that render the sidebar badges — never
 * counted separately — so mark-read and cross-tab `readState.updated` patches reset it
 * for free.
 */

const BASE_TITLE = "konus-la";

/** The badge fields of a `channel.list` row — what the derivation actually reads. */
type GuildChannelRow = { id: string; mentionsCount: number };
type DmRow = { id: string; unread: boolean };

type PrefsSnapshot = Parameters<typeof resolvePref>[0];

export function tabTitleCount(
  guildChannels: GuildChannelRow[],
  dmRows: DmRow[],
  prefs: PrefsSnapshot,
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

/**
 * Mount ONCE in the authenticated layout. Recomputes on every query-cache or prefs
 * notification — the realtime dispatcher's `message.created` / `readState.updated`
 * patches and the mark-read mutations all land in the same list caches, so resets
 * (including cross-tab reads) come for free. The write is guarded on the formatted
 * string, so the title element only changes when `n` does — static, never alternating.
 */
export function useTabTitle(): void {
  useEffect(() => {
    let last: string | null = null;
    const apply = () => {
      const guildChannels = queryClient
        .getQueriesData<GuildChannelRow[]>({ queryKey: orpc.channel.list.key() })
        .flatMap(([, rows]) => rows ?? []);
      const dmRows = queryClient
        .getQueriesData<DmRow[]>({ queryKey: orpc.dm.list.key() })
        .flatMap(([, rows]) => rows ?? []);
      const title = formatTabTitle(
        tabTitleCount(guildChannels, dmRows, useNotificationPrefs.getState()),
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

export function formatTabTitle(count: number): string {
  return count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
}
