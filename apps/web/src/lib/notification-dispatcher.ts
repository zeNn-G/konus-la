import type { RealtimeEvent } from "@konus-la/api";
import { avatarDataUri } from "@konus-la/ui/lib/avatar-uri";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { getActiveChannelId } from "@/lib/active-channel";
import { getNotificationPermission, useDesktopNotifications } from "@/lib/desktop-notifications";
import { dmDisplayName } from "@/lib/dm";
import {
  resolveChannelPref,
  type NotificationChannelKind,
  type NotificationPref,
} from "@/lib/notification-prefs";
import { listCacheRows } from "@/lib/query-cache";
import { playSoundCue } from "@/lib/sound-effects";
import type { ChannelListItem, DmListItem } from "@/lib/use-realtime";
import { orpc } from "@/utils/orpc";

/**
 * The 7.6 notification dispatcher: OS toasts and the ping sound for DM messages and
 * guild @mentions. Eligibility and delivery are decided ONCE, at event arrival in the
 * realtime dispatcher — nothing queues or re-fires on later navigation; a suppressed
 * message still drives unread/mention state through the ordinary cache patches.
 */

export type MessageCreatedEvent = Extract<RealtimeEvent, { type: "message.created" }>;

/** The slice of `message.created` the decision actually reads — tests build just this. */
export type MessageNotificationEvent = {
  guildId: string | null;
  mentionedUserIds: string[];
  message: { channelId: string; author: { id: string } };
};

/** "toast" implies the ping too — the away row of the delivery matrix is toast + sound. */
export type NotificationDelivery = "none" | "sound" | "toast";

export function decideNotification(
  event: MessageNotificationEvent,
  ctx: {
    selfUserId: string;
    activeChannelId: string | null;
    hasFocus: boolean;
    resolvePref: (channelId: string, kind: NotificationChannelKind) => NotificationPref;
  },
): NotificationDelivery {
  const { channelId, author } = event.message;
  if (author.id === ctx.selfUserId) return "none";
  const kind: NotificationChannelKind = event.guildId === null ? "dm" : "guild";
  const pref = ctx.resolvePref(channelId, kind);
  if (pref === "muted") return "none";
  // Strictly @mentions in v1: a guild reply without a mention marks unread but never
  // pings — unless the channel resolves to All.
  if (kind === "guild" && pref !== "all" && !event.mentionedUserIds.includes(ctx.selfUserId)) {
    return "none";
  }
  if (ctx.hasFocus) {
    return ctx.activeChannelId === channelId ? "none" : "sound";
  }
  return "toast";
}

export function notificationTitle(input: {
  authorName: string;
  guildId: string | null;
  channelName: string | null;
  guildName: string | null;
  groupName: string | null;
}): string {
  const where =
    input.guildId === null
      ? input.groupName
      : [input.channelName === null ? null : `#${input.channelName}`, input.guildName]
          .filter((part) => part !== null)
          .join(" — ") || null;
  return where === null ? input.authorName : `${input.authorName} (${where})`;
}

const BODY_MAX_CHARS = 150;

export function notificationBody(content: string): string {
  return content.length <= BODY_MAX_CHARS ? content : `${content.slice(0, BODY_MAX_CHARS)}…`;
}

type NavigateToChannel = (to: { guildId: string | null; channelId: string }) => void;

let navigateToChannel: NavigateToChannel | null = null;

/**
 * Toast clicks navigate through the router, but this module isn't a component — the
 * authenticated layout (mounted whenever events can arrive) lends its navigate here.
 */
export function registerNotificationNavigate(navigate: NavigateToChannel): () => void {
  navigateToChannel = navigate;
  return () => {
    if (navigateToChannel === navigate) navigateToChannel = null;
  };
}

/** One keyed row out of a (possibly partial-key-matched) family of list caches. */
function findInListCaches<T extends { id: string }>(
  client: QueryClient,
  queryKey: QueryKey,
  id: string,
): T | undefined {
  return listCacheRows<T>(client, queryKey).find((row) => row.id === id);
}

/** Channel/guild/group names come from the caches the sidebar already keeps warm. */
function lookupToastNames(client: QueryClient, selfUserId: string, event: MessageCreatedEvent) {
  if (event.guildId !== null) {
    return {
      channelName:
        findInListCaches<ChannelListItem>(client, orpc.channel.list.key(), event.message.channelId)
          ?.name ?? null,
      guildName:
        findInListCaches<{ id: string; name: string }>(
          client,
          orpc.guild.list.key(),
          event.guildId,
        )?.name ?? null,
      groupName: null,
    };
  }
  const row = findInListCaches<DmListItem>(client, orpc.dm.list.key(), event.message.channelId);
  return {
    channelName: null,
    guildName: null,
    groupName: row?.isGroup ? dmDisplayName(row, selfUserId) : null,
  };
}

function showToast(client: QueryClient, selfUserId: string, event: MessageCreatedEvent): void {
  const { message } = event;
  const author = message.author;
  const title = notificationTitle({
    authorName: author.displayName || author.username,
    guildId: event.guildId,
    ...lookupToastNames(client, selfUserId, event),
  });
  try {
    // tag = channelId + renotify false: a burst from one channel replaces its toast
    // (newest wins) instead of stacking, and the tag dedupes toasts across tabs.
    const notification = new Notification(title, {
      body: notificationBody(message.content),
      icon: author.image ?? avatarDataUri(author.username),
      tag: message.channelId,
      renotify: false,
    } as NotificationOptions);
    notification.onclick = () => {
      window.focus();
      navigateToChannel?.({ guildId: event.guildId, channelId: message.channelId });
      notification.close();
    };
  } catch {
    // Some platforms reject page-scope Notification construction — degrade to sound-only.
  }
}

/**
 * The realtime dispatcher's `message.created` hook. The ping honors its own sound
 * toggle and the master volume inside `playSoundCue`; the toast additionally needs the
 * app-level opt-in and a granted browser permission.
 */
export function dispatchMessageNotification(
  client: QueryClient,
  selfUserId: string,
  event: MessageCreatedEvent,
): void {
  const delivery = decideNotification(event, {
    selfUserId,
    activeChannelId: getActiveChannelId(),
    hasFocus: typeof document !== "undefined" && document.hasFocus(),
    resolvePref: resolveChannelPref,
  });
  if (delivery === "none") return;
  playSoundCue("notification");
  if (delivery !== "toast") return;
  if (!useDesktopNotifications.getState().enabled) return;
  if (getNotificationPermission() !== "granted") return;
  showToast(client, selfUserId, event);
}
