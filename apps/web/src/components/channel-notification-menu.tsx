import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "@konus-la/ui/components/context-menu";
import type { ReactElement, ReactNode } from "react";

import {
  resolvePref,
  useNotificationPrefs,
  type NotificationChannelKind,
  type NotificationPref,
} from "@/lib/notification-prefs";

type PrefOption = { value: NotificationPref; label: string };

const GUILD_OPTIONS: PrefOption[] = [
  { value: "all", label: "All messages" },
  { value: "mentions", label: "Mentions only" },
  { value: "muted", label: "Muted" },
];

/** DM rows have no mention concept — their pref space is binary (#76). */
const DM_OPTIONS: PrefOption[] = [
  { value: "all", label: "All messages" },
  { value: "muted", label: "Muted" },
];

type ChannelNotificationMenuProps = {
  channelId: string;
  kind: NotificationChannelKind;
  /** The sidebar row the menu attaches to (it becomes the right-click target). */
  render: ReactElement<Record<string, unknown>>;
  children?: ReactNode;
};

/**
 * The per-channel notification-pref control surface (#76): a right-click radio on
 * sidebar rows — the ONLY place channel overrides are set; the settings dialog owns
 * just the kind defaults. The radio shows the RESOLVED pref, so a row with no
 * override reads as its kind default, and picking that default keeps the map empty.
 */
export function ChannelNotificationMenu({
  channelId,
  kind,
  render,
  children,
}: ChannelNotificationMenuProps) {
  const pref = useNotificationPrefs((s) => resolvePref(s, channelId, kind));
  const setChannelPref = useNotificationPrefs((s) => s.setChannelPref);
  const options = kind === "guild" ? GUILD_OPTIONS : DM_OPTIONS;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={render}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuGroup>
          <ContextMenuLabel>Notifications</ContextMenuLabel>
          <ContextMenuRadioGroup
            value={pref}
            onValueChange={(value) => setChannelPref(channelId, kind, value as NotificationPref)}
          >
            {options.map((option) => (
              <ContextMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
