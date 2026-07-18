import { Label } from "@konus-la/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@konus-la/ui/components/select";
import { Switch } from "@konus-la/ui/components/switch";
import { useState } from "react";

import {
  enableDesktopNotifications,
  getNotificationPermission,
  useDesktopNotifications,
} from "@/lib/desktop-notifications";
import {
  BUILT_IN_KIND_DEFAULTS,
  DM_PREF_OPTIONS,
  GUILD_PREF_OPTIONS,
  useNotificationPrefs,
  type NotificationPref,
} from "@/lib/notification-prefs";
import { isSoundCueEnabled, useSoundPrefs } from "@/lib/sound-effects";

/**
 * The dialog's Notifications section: the desktop-notifications opt-in with its
 * browser-permission state (7.6), the configurable kind defaults, and the
 * notification-ping sound toggle (#87). Per-channel overrides live in the sidebar
 * context menus, not here (#76).
 */
export function NotificationsSection() {
  const defaults = useNotificationPrefs((s) => s.defaults);
  const setKindDefault = useNotificationPrefs((s) => s.setKindDefault);
  const soundPrefs = useSoundPrefs((s) => s.prefs);
  const setCueEnabled = useSoundPrefs((s) => s.setCueEnabled);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <DesktopNotificationsToggle />

      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 sm:grid-cols-2">
        <DefaultSelect
          label="Direct messages default"
          items={DM_PREF_OPTIONS}
          value={defaults.dm ?? BUILT_IN_KIND_DEFAULTS.dm}
          onChange={(value) => setKindDefault("dm", value)}
        />
        <DefaultSelect
          label="Guild channels default"
          items={GUILD_PREF_OPTIONS}
          value={defaults.guild ?? BUILT_IN_KIND_DEFAULTS.guild}
          onChange={(value) => setKindDefault("guild", value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Sounds
        </div>
        <div className="flex items-center gap-2 border-b border-border/50 py-1.5">
          <span className="flex-1 text-sm">Notification ping</span>
          <Switch
            aria-label="Notification ping"
            checked={isSoundCueEnabled(soundPrefs, "notification")}
            onCheckedChange={(checked) => setCueEnabled("notification", checked)}
          />
        </div>
      </div>
    </div>
  );
}

const PERMISSION_PILL: Record<NotificationPermission, string> = {
  granted: "Allowed",
  default: "Not requested",
  denied: "Blocked",
};

/**
 * The app-level opt-in (7.6): flipping it on while browser permission is `default`
 * triggers the permission prompt on that gesture; `denied` disables the toggle with a
 * hint. Permission has no change event — re-read it after every request.
 */
function DesktopNotificationsToggle() {
  const enabled = useDesktopNotifications((s) => s.enabled);
  const setEnabled = useDesktopNotifications((s) => s.setEnabled);
  const [permission, setPermission] = useState(getNotificationPermission);

  const blocked = permission === "denied" || permission === null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 border-b border-border/50 py-1.5">
        <span className="flex-1 text-sm">Desktop notifications</span>
        <span className="rounded-full border border-foreground/10 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
          {permission === null ? "Unsupported" : PERMISSION_PILL[permission]}
        </span>
        <Switch
          aria-label="Desktop notifications"
          checked={enabled && permission === "granted"}
          disabled={blocked}
          onCheckedChange={(checked) => {
            if (!checked) {
              setEnabled(false);
              return;
            }
            void enableDesktopNotifications().then(() =>
              setPermission(getNotificationPermission()),
            );
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {permission === null
          ? "Your browser doesn't support desktop notifications."
          : permission === "denied"
            ? "Notifications are blocked in your browser settings for this site."
            : "OS notifications for DMs and @mentions while the tab is unfocused. Sounds work either way."}
      </p>
    </div>
  );
}

/** One kind-default dropdown; picking the built-in clears its override (#87). */
function DefaultSelect<T extends NotificationPref>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select items={items} value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
