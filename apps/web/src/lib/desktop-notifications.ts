import { toast } from "sonner";
import { create } from "zustand";

/**
 * The app-level Desktop-notifications pref (#75): browser permission × an explicit
 * opt-in that defaults OFF. Sounds and the tab title work regardless of permission;
 * `Notification.requestPermission()` only ever rides a user gesture — the Notifications
 * section toggle or the one-time post-sign-in nudge toast's Enable button.
 */

export const DESKTOP_NOTIFICATIONS_STORAGE_KEY = "konusLa.desktop-notifications";
export const NOTIFICATION_NUDGE_DISMISSED_STORAGE_KEY = "konusLa.notification-nudge-dismissed";

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Overrides-only persistence: OFF is the default, so false leaves no key behind. */
function persistFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, "true");
    else localStorage.removeItem(key);
  } catch {
    // storage full/blocked — the pref still applies for this session
  }
}

interface DesktopNotificationsState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

/** No cross-tab sync (per the phase-7 key table — matches the device prefs). */
export const useDesktopNotifications = create<DesktopNotificationsState>()((set) => ({
  enabled: loadFlag(DESKTOP_NOTIFICATIONS_STORAGE_KEY),
  setEnabled: (enabled) => {
    persistFlag(DESKTOP_NOTIFICATIONS_STORAGE_KEY, enabled);
    set({ enabled });
  },
}));

/** `null` = the Notifications API doesn't exist here at all. */
export function getNotificationPermission(): NotificationPermission | null {
  return typeof Notification === "undefined" ? null : Notification.permission;
}

/**
 * The one enabling path (toggle and nudge both ride it) — must be called from a user
 * gesture. Resolves true when the pref ends up ON.
 */
export async function enableDesktopNotifications(): Promise<boolean> {
  const permission = getNotificationPermission();
  if (permission === null || permission === "denied") return false;
  const result = permission === "granted" ? "granted" : await Notification.requestPermission();
  if (result !== "granted") return false;
  useDesktopNotifications.getState().setEnabled(true);
  return true;
}

export function isNudgeDismissed(): boolean {
  return loadFlag(NOTIFICATION_NUDGE_DISMISSED_STORAGE_KEY);
}

export function markNudgeDismissed(): void {
  persistFlag(NOTIFICATION_NUDGE_DISMISSED_STORAGE_KEY, true);
}

export function shouldShowNudge(input: {
  dismissed: boolean;
  enabled: boolean;
  permission: NotificationPermission | null;
}): boolean {
  // Blocked/unsupported: the Enable gesture couldn't succeed, so nudging is noise —
  // but the flag stays unset, so unblocking later revives the one-time offer.
  return (
    !input.dismissed &&
    !input.enabled &&
    (input.permission === "default" || input.permission === "granted")
  );
}

let nudgeShownThisSession = false;

/**
 * The one-time post-sign-in nudge (#75): a persistent dismissible toast whose Enable
 * button is the permission gesture. Any interaction — Enable or Not now — sets the
 * dismissed flag; it never repeats after that.
 */
export function maybeShowNotificationNudge(): void {
  if (nudgeShownThisSession) return;
  if (
    !shouldShowNudge({
      dismissed: isNudgeDismissed(),
      enabled: useDesktopNotifications.getState().enabled,
      permission: getNotificationPermission(),
    })
  ) {
    return;
  }
  nudgeShownThisSession = true;
  // Deferred a tick: fired from a mount effect, the root Toaster hasn't subscribed
  // yet and sonner drops subscriber-less toasts.
  setTimeout(showNudgeToast, 0);
}

function showNudgeToast(): void {
  toast("Enable desktop notifications?", {
    description: "Get an OS notification for DMs and @mentions while you're away.",
    duration: Number.POSITIVE_INFINITY,
    // Any way out — Enable, Not now, or a swipe-away — counts as dismissed for good.
    onDismiss: () => markNudgeDismissed(),
    action: {
      label: "Enable",
      onClick: () => {
        markNudgeDismissed();
        void enableDesktopNotifications();
      },
    },
    cancel: {
      label: "Not now",
      onClick: () => markNudgeDismissed(),
    },
  });
}
