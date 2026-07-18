import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  NOTIFICATION_DEFAULTS_STORAGE_KEY,
  NOTIFICATION_PREFS_STORAGE_KEY,
  rehydrateNotificationPrefs,
  resolveChannelPref,
  useNotificationPrefs,
} from "./notification-prefs";

/**
 * The per-channel notification-pref seam (#76 / phase-7.5): the synchronous resolver's
 * override → configured kind default → built-in precedence, the overrides-only
 * persistence of both maps, and cross-tab `storage` rehydration.
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
  useNotificationPrefs.setState({ prefs: {}, defaults: {} });
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("resolveChannelPref — built-in kind defaults", () => {
  test("an unknown channel resolves to its kind's built-in default", () => {
    expect(resolveChannelPref("guild-channel", "guild")).toBe("mentions");
    expect(resolveChannelPref("dm-channel", "dm")).toBe("all");
  });
});

describe("setChannelPref — the overrides map", () => {
  test("a non-default pref is recorded, resolved, and persisted", () => {
    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "muted");

    expect(resolveChannelPref("guild-channel", "guild")).toBe("muted");
    expect(resolveChannelPref("other-channel", "guild")).toBe("mentions");
    expect(JSON.parse(stored.get(NOTIFICATION_PREFS_STORAGE_KEY)!)).toEqual({
      "guild-channel": "muted",
    });
  });

  test("setting a channel back to its kind default deletes its entry", () => {
    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "muted");
    useNotificationPrefs.getState().setChannelPref("dm-channel", "dm", "muted");

    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "mentions");

    expect(useNotificationPrefs.getState().prefs).toEqual({ "dm-channel": "muted" });
    expect(JSON.parse(stored.get(NOTIFICATION_PREFS_STORAGE_KEY)!)).toEqual({
      "dm-channel": "muted",
    });
  });

  test("the last entry clearing removes the storage key entirely", () => {
    useNotificationPrefs.getState().setChannelPref("dm-channel", "dm", "muted");
    useNotificationPrefs.getState().setChannelPref("dm-channel", "dm", "all");

    expect(useNotificationPrefs.getState().prefs).toEqual({});
    expect(stored.has(NOTIFICATION_PREFS_STORAGE_KEY)).toBe(false);
  });
});

describe("setKindDefault — configurable kind defaults (spec addition)", () => {
  test("a configured default is persisted and consulted for channels with no override", () => {
    useNotificationPrefs.getState().setKindDefault("guild", "muted");

    expect(resolveChannelPref("any-guild-channel", "guild")).toBe("muted");
    expect(resolveChannelPref("dm-channel", "dm")).toBe("all");
    expect(JSON.parse(stored.get(NOTIFICATION_DEFAULTS_STORAGE_KEY)!)).toEqual({
      guild: "muted",
    });
  });

  test("a channel override still wins over the configured default", () => {
    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "all");
    useNotificationPrefs.getState().setKindDefault("guild", "muted");

    expect(resolveChannelPref("guild-channel", "guild")).toBe("all");
  });

  test("setting a kind back to its built-in deletes the entry and the empty key", () => {
    useNotificationPrefs.getState().setKindDefault("guild", "muted");
    useNotificationPrefs.getState().setKindDefault("guild", "mentions");

    expect(useNotificationPrefs.getState().defaults).toEqual({});
    expect(stored.has(NOTIFICATION_DEFAULTS_STORAGE_KEY)).toBe(false);
  });

  test("back-to-default channel deletion honors the CONFIGURED default, not the built-in", () => {
    useNotificationPrefs.getState().setKindDefault("guild", "all");

    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "all");
    expect(useNotificationPrefs.getState().prefs).toEqual({});

    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "mentions");
    expect(useNotificationPrefs.getState().prefs).toEqual({ "guild-channel": "mentions" });
  });
});

describe("cross-tab storage rehydration (#76)", () => {
  test("another tab's write to either key re-hydrates that map", () => {
    stored.set(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify({ "guild-channel": "muted" }));
    rehydrateNotificationPrefs(NOTIFICATION_PREFS_STORAGE_KEY);
    expect(resolveChannelPref("guild-channel", "guild")).toBe("muted");

    stored.set(NOTIFICATION_DEFAULTS_STORAGE_KEY, JSON.stringify({ dm: "muted" }));
    rehydrateNotificationPrefs(NOTIFICATION_DEFAULTS_STORAGE_KEY);
    expect(resolveChannelPref("dm-channel", "dm")).toBe("muted");
  });

  test("an unrelated key's event leaves the store untouched", () => {
    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "muted");
    stored.set(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify({ "guild-channel": "all" }));

    rehydrateNotificationPrefs("konusLa.sound-prefs");

    expect(resolveChannelPref("guild-channel", "guild")).toBe("muted");
  });

  test("a null key (storage.clear() elsewhere) resets both maps", () => {
    useNotificationPrefs.getState().setChannelPref("guild-channel", "guild", "muted");
    useNotificationPrefs.getState().setKindDefault("dm", "muted");
    stored.clear();

    rehydrateNotificationPrefs(null);

    expect(useNotificationPrefs.getState().prefs).toEqual({});
    expect(useNotificationPrefs.getState().defaults).toEqual({});
  });

  test("corrupt JSON hydrates as empty, not a crash", () => {
    stored.set(NOTIFICATION_PREFS_STORAGE_KEY, "{not json");
    stored.set(NOTIFICATION_DEFAULTS_STORAGE_KEY, "[42");

    rehydrateNotificationPrefs(null);

    expect(useNotificationPrefs.getState().prefs).toEqual({});
    expect(useNotificationPrefs.getState().defaults).toEqual({});
  });
});
