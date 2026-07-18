import { describe, expect, test } from "vitest";

import {
  decideNotification,
  notificationBody,
  notificationTitle,
  type MessageNotificationEvent,
} from "./notification-dispatcher";
import type { NotificationChannelKind, NotificationPref } from "./notification-prefs";

/**
 * The 7.6 dispatcher's pure core: the trigger matrix (own message / kind rule / pref)
 * and the delivery matrix (focused+viewing → none, focused elsewhere → sound,
 * away → toast+sound), plus the OS-toast title/body builders.
 */

const SELF = "self-user";

function event(overrides?: Partial<MessageNotificationEvent>): MessageNotificationEvent {
  return {
    guildId: null,
    mentionedUserIds: [],
    message: { channelId: "channel-1", author: { id: "other-user" } },
    ...overrides,
  };
}

function ctx(overrides?: {
  activeChannelId?: string | null;
  hasFocus?: boolean;
  prefs?: Partial<Record<string, NotificationPref>>;
}) {
  return {
    selfUserId: SELF,
    activeChannelId: overrides?.activeChannelId ?? null,
    hasFocus: overrides?.hasFocus ?? false,
    resolvePref: (channelId: string, kind: NotificationChannelKind): NotificationPref =>
      overrides?.prefs?.[channelId] ?? (kind === "dm" ? "all" : "mentions"),
  };
}

describe("decideNotification — trigger matrix", () => {
  test("the viewer's own message never notifies", () => {
    expect(
      decideNotification(
        event({ message: { channelId: "channel-1", author: { id: SELF } } }),
        ctx(),
      ),
    ).toBe("none");
  });

  test("any DM message is eligible under the kind default", () => {
    expect(decideNotification(event(), ctx())).toBe("toast");
  });

  test("a guild message without a mention stays silent under Mentions-only", () => {
    expect(decideNotification(event({ guildId: "guild-1" }), ctx())).toBe("none");
  });

  test("a guild @mention of the viewer is eligible", () => {
    expect(
      decideNotification(event({ guildId: "guild-1", mentionedUserIds: [SELF] }), ctx()),
    ).toBe("toast");
  });

  test("a mention of someone else is not a mention of the viewer", () => {
    expect(
      decideNotification(event({ guildId: "guild-1", mentionedUserIds: ["other-user"] }), ctx()),
    ).toBe("none");
  });

  test("a guild channel resolved to All pings without a mention", () => {
    expect(
      decideNotification(event({ guildId: "guild-1" }), ctx({ prefs: { "channel-1": "all" } })),
    ).toBe("toast");
  });

  test("Muted kills both toast and sound, even for a mention", () => {
    const muted = ctx({ prefs: { "channel-1": "muted" } });
    expect(decideNotification(event(), muted)).toBe("none");
    expect(
      decideNotification(event({ guildId: "guild-1", mentionedUserIds: [SELF] }), muted),
    ).toBe("none");
  });
});

describe("decideNotification — delivery matrix", () => {
  test("focused with the source channel on screen → nothing", () => {
    expect(
      decideNotification(event(), ctx({ hasFocus: true, activeChannelId: "channel-1" })),
    ).toBe("none");
  });

  test("focused on a different channel → sound only", () => {
    expect(
      decideNotification(event(), ctx({ hasFocus: true, activeChannelId: "channel-2" })),
    ).toBe("sound");
  });

  test("focused with no channel route on screen → sound only", () => {
    expect(decideNotification(event(), ctx({ hasFocus: true, activeChannelId: null }))).toBe(
      "sound",
    );
  });

  test("unfocused → toast even while the channel is the active route", () => {
    expect(
      decideNotification(event(), ctx({ hasFocus: false, activeChannelId: "channel-1" })),
    ).toBe("toast");
  });
});

describe("notificationTitle", () => {
  test("guild message: author (#channel — Guild)", () => {
    expect(
      notificationTitle({
        authorName: "Alice",
        guildId: "guild-1",
        channelName: "general",
        guildName: "Role Demo",
        groupName: null,
      }),
    ).toBe("Alice (#general — Role Demo)");
  });

  test("guild message with names missing from the caches degrades gracefully", () => {
    expect(
      notificationTitle({
        authorName: "Alice",
        guildId: "guild-1",
        channelName: null,
        guildName: "Role Demo",
        groupName: null,
      }),
    ).toBe("Alice (Role Demo)");
    expect(
      notificationTitle({
        authorName: "Alice",
        guildId: "guild-1",
        channelName: "general",
        guildName: null,
        groupName: null,
      }),
    ).toBe("Alice (#general)");
    expect(
      notificationTitle({
        authorName: "Alice",
        guildId: "guild-1",
        channelName: null,
        guildName: null,
        groupName: null,
      }),
    ).toBe("Alice");
  });

  test("1:1 DM: the author's name alone", () => {
    expect(
      notificationTitle({
        authorName: "Alice",
        guildId: null,
        channelName: null,
        guildName: null,
        groupName: null,
      }),
    ).toBe("Alice");
  });

  test("group DM: author (group name)", () => {
    expect(
      notificationTitle({
        authorName: "Alice",
        guildId: null,
        channelName: null,
        guildName: null,
        groupName: "weekend crew",
      }),
    ).toBe("Alice (weekend crew)");
  });
});

describe("notificationBody", () => {
  test("short content passes through untouched", () => {
    expect(notificationBody("hey")).toBe("hey");
  });

  test("long content truncates to ~150 chars with an ellipsis", () => {
    const body = notificationBody("x".repeat(400));
    expect(body).toBe(`${"x".repeat(150)}…`);
  });
});
