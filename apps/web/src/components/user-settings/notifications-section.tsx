import { Button } from "@konus-la/ui/components/button";
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
import { PlayIcon } from "lucide-react";

import {
  BUILT_IN_KIND_DEFAULTS,
  useNotificationPrefs,
  type DmNotificationPref,
  type NotificationPref,
} from "@/lib/notification-prefs";
import { isSoundCueEnabled, previewSoundCue, useSoundPrefs } from "@/lib/sound-effects";

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
          items={[
            { value: "all", label: "All messages" },
            { value: "muted", label: "Muted" },
          ]}
          value={defaults.dm ?? BUILT_IN_KIND_DEFAULTS.dm}
          onChange={(value) => setKindDefault("dm", value as DmNotificationPref)}
        />
        <DefaultSelect
          label="Guild channels default"
          items={[
            { value: "all", label: "All messages" },
            { value: "mentions", label: "Mentions only" },
            { value: "muted", label: "Muted" },
          ]}
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
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Preview notification ping"
            title="Preview"
            className="text-muted-foreground"
            onClick={() => previewSoundCue("notification")}
          >
            <PlayIcon className="size-3.5" />
          </Button>
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
function DefaultSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: Array<{ value: NotificationPref; label: string }>;
  value: NotificationPref;
  onChange: (value: NotificationPref) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next as NotificationPref)}
      >
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
