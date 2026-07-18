import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DESKTOP_NOTIFICATIONS_STORAGE_KEY,
  isNudgeDismissed,
  markNudgeDismissed,
  NOTIFICATION_NUDGE_DISMISSED_STORAGE_KEY,
  shouldShowNudge,
  useDesktopNotifications,
} from "./desktop-notifications";

/**
 * The app-level Desktop-notifications pref (#75): defaults OFF, opt-in is explicit and
 * persisted; the one-time post-sign-in nudge is gated by a localStorage flag.
 */

/** Node has no localStorage — a Map-backed stand-in observes the persistence writes. */
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
  useDesktopNotifications.setState({ enabled: false });
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("desktop-notifications pref", () => {
  test("enabling persists; disabling returns to the keyless OFF default", () => {
    useDesktopNotifications.getState().setEnabled(true);
    expect(useDesktopNotifications.getState().enabled).toBe(true);
    expect(stored.get(DESKTOP_NOTIFICATIONS_STORAGE_KEY)).toBe("true");

    useDesktopNotifications.getState().setEnabled(false);
    expect(useDesktopNotifications.getState().enabled).toBe(false);
    expect(stored.has(DESKTOP_NOTIFICATIONS_STORAGE_KEY)).toBe(false);
  });
});

describe("nudge dismissal flag", () => {
  test("dismissing sets the flag once and for all", () => {
    expect(isNudgeDismissed()).toBe(false);
    markNudgeDismissed();
    expect(isNudgeDismissed()).toBe(true);
    expect(stored.get(NOTIFICATION_NUDGE_DISMISSED_STORAGE_KEY)).toBe("true");
  });
});

describe("shouldShowNudge", () => {
  test("shows only while undismissed, disabled, and permission is obtainable", () => {
    expect(shouldShowNudge({ dismissed: false, enabled: false, permission: "default" })).toBe(true);
    expect(shouldShowNudge({ dismissed: false, enabled: false, permission: "granted" })).toBe(true);
  });

  test("never shows once dismissed or already enabled", () => {
    expect(shouldShowNudge({ dismissed: true, enabled: false, permission: "default" })).toBe(false);
    expect(shouldShowNudge({ dismissed: false, enabled: true, permission: "default" })).toBe(false);
  });

  test("never shows when blocked or unsupported — the Enable gesture couldn't succeed", () => {
    expect(shouldShowNudge({ dismissed: false, enabled: false, permission: "denied" })).toBe(false);
    expect(shouldShowNudge({ dismissed: false, enabled: false, permission: null })).toBe(false);
  });
});
