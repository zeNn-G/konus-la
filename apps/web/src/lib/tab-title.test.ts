import { describe, expect, test } from "vitest";

import type { NotificationPref } from "./notification-prefs";
import { formatTabTitle, tabTitleCount } from "./tab-title";

function prefsState(prefs?: Partial<Record<string, NotificationPref>>) {
  return { prefs: prefs ?? {}, defaults: {} };
}

function guildChannel(id: string, mentionsCount: number, unread = mentionsCount > 0) {
  return { id, mentionsCount, unread };
}

/**
 * The 7.7 tab-title counter's pure core (#75): `(n) konus-la` formatting and the
 * derivation of `n` from the sidebar-badge rows — Σ mentionsCount over unmuted guild
 * channels + 1 per unread unmuted DM conversation.
 */

describe("tabTitleCount — guild channels", () => {
  test("sums mentionsCount across channels", () => {
    expect(
      tabTitleCount([guildChannel("a", 2), guildChannel("b", 3)], [], prefsState()),
    ).toBe(5);
  });

  test("a plain unread channel (bold, no mention) contributes nothing", () => {
    expect(tabTitleCount([guildChannel("a", 0, true)], [], prefsState())).toBe(0);
  });

  test("a muted channel's mentions are silenced; others still count", () => {
    expect(
      tabTitleCount(
        [guildChannel("a", 2), guildChannel("b", 3)],
        [],
        prefsState({ a: "muted" }),
      ),
    ).toBe(3);
  });

  test("a guild kind-default of Muted silences unoverridden channels", () => {
    expect(
      tabTitleCount([guildChannel("a", 2), guildChannel("b", 3)], [], {
        prefs: { b: "mentions" },
        defaults: { guild: "muted" as const },
      }),
    ).toBe(3);
  });
});

describe("tabTitleCount — DM conversations", () => {
  test("each unread conversation contributes exactly 1, read ones nothing", () => {
    expect(
      tabTitleCount(
        [],
        [
          { id: "dm-1", unread: true },
          { id: "dm-2", unread: true },
          { id: "dm-3", unread: false },
        ],
        prefsState(),
      ),
    ).toBe(2);
  });

  test("a muted unread conversation is silenced", () => {
    expect(
      tabTitleCount([], [{ id: "dm-1", unread: true }], prefsState({ "dm-1": "muted" })),
    ).toBe(0);
  });

  test("guild mentions and unread DMs add up", () => {
    expect(
      tabTitleCount([guildChannel("a", 2)], [{ id: "dm-1", unread: true }], prefsState()),
    ).toBe(3);
  });
});

describe("formatTabTitle", () => {
  test("zero restores the bare title", () => {
    expect(formatTabTitle(0)).toBe("konus-la");
  });

  test("a positive count prefixes (n)", () => {
    expect(formatTabTitle(3)).toBe("(3) konus-la");
  });
});
