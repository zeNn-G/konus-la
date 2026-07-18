import { create } from "zustand";

/**
 * Per-channel notification preferences (phase-7 spec §Per-channel preference model #76):
 * two overrides-only localStorage maps — per-channel prefs and configurable kind
 * defaults — behind one store. The resolver is synchronous and the CALLER supplies the
 * channel kind (the dispatcher derives it from the event's `guildId`, the UI knows its
 * row); the store keeps no channel-type lookup.
 */

export type NotificationPref = "all" | "mentions" | "muted";
/** DM rows have no mention concept — their pref space is binary. */
export type DmNotificationPref = "all" | "muted";
export type NotificationChannelKind = "guild" | "dm";

export const BUILT_IN_KIND_DEFAULTS: {
  guild: NotificationPref;
  dm: DmNotificationPref;
} = { guild: "mentions", dm: "all" };

type KindDefaults = { guild?: NotificationPref; dm?: DmNotificationPref };

/**
 * The user-facing option lists — one source for the sidebar radios and the dialog's
 * kind-default selects, so the two surfaces can't drift.
 */
export const GUILD_PREF_OPTIONS: ReadonlyArray<{ value: NotificationPref; label: string }> = [
  { value: "all", label: "All messages" },
  { value: "mentions", label: "Mentions only" },
  { value: "muted", label: "Muted" },
];

export const DM_PREF_OPTIONS: ReadonlyArray<{ value: DmNotificationPref; label: string }> = [
  { value: "all", label: "All messages" },
  { value: "muted", label: "Muted" },
];

export const NOTIFICATION_PREFS_STORAGE_KEY = "konusLa.notification-prefs";
export const NOTIFICATION_DEFAULTS_STORAGE_KEY = "konusLa.notification-defaults";

/** Overrides-only maps leave no key behind when the last override clears. */
function persistMap(key: string, map: Record<string, unknown>): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // storage full/blocked — the pref still applies for this session
  }
}

function loadMap<T>(key: string): T {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // absent localStorage / corrupt JSON — fall through to empty
  }
  return {} as T;
}

const loadPrefs = () =>
  loadMap<Partial<Record<string, NotificationPref>>>(NOTIFICATION_PREFS_STORAGE_KEY);
const loadDefaults = () => loadMap<KindDefaults>(NOTIFICATION_DEFAULTS_STORAGE_KEY);

interface NotificationPrefsState {
  /** The `konusLa.notification-prefs` overrides map — absent channel = kind default. */
  prefs: Partial<Record<string, NotificationPref>>;
  /** The `konusLa.notification-defaults` overrides map — absent kind = built-in. */
  defaults: KindDefaults;
  setChannelPref: (
    channelId: string,
    kind: NotificationChannelKind,
    pref: NotificationPref,
  ) => void;
  setKindDefault: {
    (kind: "guild", pref: NotificationPref): void;
    (kind: "dm", pref: DmNotificationPref): void;
  };
}

export const useNotificationPrefs = create<NotificationPrefsState>()((set) => ({
  prefs: loadPrefs(),
  defaults: loadDefaults(),

  setChannelPref: (channelId, kind, pref) =>
    set((state) => {
      const prefs = { ...state.prefs };
      // Back to the RESOLVED kind default (configured or built-in) = no override.
      if (pref === (state.defaults[kind] ?? BUILT_IN_KIND_DEFAULTS[kind])) {
        delete prefs[channelId];
      } else {
        prefs[channelId] = pref;
      }
      persistMap(NOTIFICATION_PREFS_STORAGE_KEY, prefs);
      return { prefs };
    }),

  setKindDefault: (kind: NotificationChannelKind, pref: NotificationPref) =>
    set((state) => {
      const defaults = { ...state.defaults };
      if (pref === BUILT_IN_KIND_DEFAULTS[kind]) {
        delete defaults[kind];
      } else if (kind === "guild") {
        defaults.guild = pref;
      } else {
        defaults.dm = pref as DmNotificationPref;
      }
      persistMap(NOTIFICATION_DEFAULTS_STORAGE_KEY, defaults);
      return { defaults };
    }),
}));

/** Override → configured kind default → built-in, per the #76 read contract. */
export function resolvePref(
  state: Pick<NotificationPrefsState, "prefs" | "defaults">,
  channelId: string,
  kind: NotificationChannelKind,
): NotificationPref {
  return state.prefs[channelId] ?? state.defaults[kind] ?? BUILT_IN_KIND_DEFAULTS[kind];
}

/** The synchronous module-level resolver — the dispatcher's entry (#76). */
export function resolveChannelPref(
  channelId: string,
  kind: NotificationChannelKind,
): NotificationPref {
  return resolvePref(useNotificationPrefs.getState(), channelId, kind);
}

/**
 * Cross-tab sync (#76): re-hydrate the map a `storage` event names (null key =
 * `storage.clear()` — reload both). The event fires only in OTHER tabs, so muting a
 * channel in one tab dims and silences it everywhere.
 */
export function rehydrateNotificationPrefs(key: string | null): void {
  if (key === null) {
    useNotificationPrefs.setState({ prefs: loadPrefs(), defaults: loadDefaults() });
  } else if (key === NOTIFICATION_PREFS_STORAGE_KEY) {
    useNotificationPrefs.setState({ prefs: loadPrefs() });
  } else if (key === NOTIFICATION_DEFAULTS_STORAGE_KEY) {
    useNotificationPrefs.setState({ defaults: loadDefaults() });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => rehydrateNotificationPrefs(event.key));
}
