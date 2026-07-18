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

import {
  BUILT_IN_KIND_DEFAULTS,
  DM_PREF_OPTIONS,
  GUILD_PREF_OPTIONS,
  useNotificationPrefs,
  type NotificationPref,
} from "@/lib/notification-prefs";
import { isSoundCueEnabled, useSoundPrefs } from "@/lib/sound-effects";

/**
 * The dialog's Notifications section (#87 share): the configurable kind defaults and
 * the notification-ping sound toggle. Per-channel overrides live in the sidebar
 * context menus, not here (#76); the permission pill, desktop-notifications toggle,
 * and nudge are the dispatcher ticket's (7.6).
 */
export function NotificationsSection() {
  const defaults = useNotificationPrefs((s) => s.defaults);
  const setKindDefault = useNotificationPrefs((s) => s.setKindDefault);
  const soundPrefs = useSoundPrefs((s) => s.prefs);
  const setCueEnabled = useSoundPrefs((s) => s.setCueEnabled);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
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
