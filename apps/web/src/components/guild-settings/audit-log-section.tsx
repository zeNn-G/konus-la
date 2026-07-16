import type { AppRouterClient } from "@konus-la/api/routers/index";
import { Button } from "@konus-la/ui/components/button";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightIcon,
  ArrowUpDownIcon,
  CrownIcon,
  FlagIcon,
  HashIcon,
  MessageSquareXIcon,
  MicOffIcon,
  PencilLineIcon,
  PhoneOffIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldMinusIcon,
  ShieldOffIcon,
  ShieldPlusIcon,
  TicketIcon,
  TicketXIcon,
  Trash2Icon,
  UserCheckIcon,
  UserMinusIcon,
  UserXIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { PERMISSION_GROUPS } from "@/components/guild-settings/permission-groups";
import { RoleDot } from "@/components/guild-settings/role-dot";
import { orpc } from "@/utils/orpc";

type AuditPage = Awaited<ReturnType<AppRouterClient["auditLog"]["list"]>>;
type AuditEntry = AuditPage["entries"][number];

const auditLogInput = (guildId: string) => (pageParam: string | undefined) =>
  pageParam ? { guildId, before: pageParam } : { guildId };

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function relativeTime(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, span] of TIME_UNITS) {
    if (Math.abs(seconds) >= span) return relativeFormat.format(Math.round(seconds / span), unit);
  }
  return "just now";
}

type ActionStyle = { icon: LucideIcon; destructive?: boolean };

/**
 * Leading icon per action, reusing the settings nav's noun vocabulary (shield = roles,
 * hash = channels, ticket = invites, crown = ownership) with verb variants. Destructive
 * actions — the ones that take something away from someone — carry the tinted tile.
 */
const ACTION_STYLE = {
  "member.kick": { icon: UserMinusIcon, destructive: true },
  "member.ban": { icon: UserXIcon, destructive: true },
  "member.unban": { icon: UserCheckIcon },
  "member.serverMute": { icon: MicOffIcon },
  "member.voiceDisconnect": { icon: PhoneOffIcon },
  "message.modDelete": { icon: MessageSquareXIcon, destructive: true },
  "role.create": { icon: ShieldPlusIcon },
  "role.update": { icon: ShieldIcon },
  "role.delete": { icon: ShieldMinusIcon, destructive: true },
  "role.reorder": { icon: ArrowUpDownIcon },
  "role.assign": { icon: ShieldCheckIcon },
  "role.unassign": { icon: ShieldOffIcon },
  "channel.create": { icon: HashIcon },
  "channel.update": { icon: PencilLineIcon },
  "channel.delete": { icon: Trash2Icon, destructive: true },
  "guild.update": { icon: PencilLineIcon },
  "guild.transferOwnership": { icon: CrownIcon },
  "invite.create": { icon: TicketIcon },
  "invite.revoke": { icon: TicketXIcon, destructive: true },
  "report.resolve": { icon: FlagIcon },
} satisfies Record<AuditEntry["action"], ActionStyle>;

/** Unknown actions (a newer server) fall back to the section's own icon, never a blank. */
function styleFor(action: string): ActionStyle {
  return (
    (ACTION_STYLE as Record<string, ActionStyle | undefined>)[action] ?? { icon: ScrollTextIcon }
  );
}

function displayName(user: { username: string | null; displayName: string | null } | null) {
  return user?.displayName || user?.username || null;
}

const strong = (value: ReactNode) => <span className="font-medium">{value}</span>;

/** An old → new pair joined by the arrow glyph every diff in the view shares. */
function diff(from: ReactNode, to: ReactNode): ReactNode {
  return (
    <span className="inline-flex items-center gap-1 align-bottom">
      {from}
      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      {to}
    </span>
  );
}

/** The target member's name; a deleted account falls back to its recorded id. */
function target(entry: AuditEntry): ReactNode {
  return strong(displayName(entry.targetUser) ?? entry.targetUserId ?? "someone");
}

const permissionLabels = new Map(
  PERMISSION_GROUPS.flatMap((group) => group.permissions).map((p) => [p.bit, p.label]),
);

/** `[old, new]` bitfields → one chip per toggled bit; revoked bits carry the warning tint. */
function permissionChips([oldBits, newBits]: [number, number]): ReactNode {
  const chips: { label: string; removed: boolean }[] = [];
  for (const [bit, label] of permissionLabels) {
    if (newBits & bit && !(oldBits & bit)) chips.push({ label, removed: false });
    if (oldBits & bit && !(newBits & bit)) chips.push({ label, removed: true });
  }
  return (
    <span className="inline-flex flex-wrap gap-1 align-bottom">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={cn(
            "rounded px-1 py-px text-[11px]",
            chip.removed ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground/80",
          )}
        >
          {chip.removed ? "−" : "+"} {chip.label}
        </span>
      ))}
    </span>
  );
}

function colorValue(color: unknown): ReactNode {
  if (typeof color !== "string") return "none";
  return (
    <span className="inline-flex items-center gap-1">
      <RoleDot color={color} />
      {color}
    </span>
  );
}

/**
 * One diff line per changed field of a `role.update` entry — the metadata's `[old, new]`
 * pairs rendered human-readably (permission bits as their toggle labels).
 */
function roleUpdateDetail(changed: Record<string, [unknown, unknown]>): ReactNode {
  return (
    <>
      {changed.name && (
        <div>renamed {diff(String(changed.name[0]), String(changed.name[1]))}</div>
      )}
      {changed.color && (
        <div>color {diff(colorValue(changed.color[0]), colorValue(changed.color[1]))}</div>
      )}
      {changed.permissions && (
        <div>permissions {permissionChips(changed.permissions as [number, number])}</div>
      )}
    </>
  );
}

/**
 * The action phrase + optional detail line for one entry, per the spec's action/metadata
 * table. Unknown actions (a newer server) fall back to the raw action string rather than
 * hiding the entry — a forensic view never omits records.
 */
function describeEntry(entry: AuditEntry): { phrase: ReactNode; detail?: ReactNode } {
  const meta = entry.metadata;
  switch (entry.action) {
    case "member.kick":
      return { phrase: <>kicked {target(entry)}</> };
    case "member.ban":
      return {
        phrase: <>banned {target(entry)}</>,
        detail: meta.reason ? <>reason: {String(meta.reason)}</> : undefined,
      };
    case "member.unban":
      return { phrase: <>unbanned {target(entry)}</> };
    case "member.serverMute":
      return {
        phrase: (
          <>
            {meta.muted ? "server-muted" : "server-unmuted"} {target(entry)}
          </>
        ),
      };
    case "member.voiceDisconnect":
      return { phrase: <>disconnected {target(entry)} from voice</> };
    case "message.modDelete":
      return {
        phrase: <>deleted a message by {target(entry)}</>,
        detail: (
          <>
            {meta.reason ? <div>reason: {String(meta.reason)}</div> : null}
            <div>“{String(meta.contentSnippet ?? "")}”</div>
          </>
        ),
      };
    case "role.create":
      return { phrase: <>created role {strong(String(meta.name))}</> };
    case "role.update": {
      const changed = (meta.changed ?? {}) as Record<string, [unknown, unknown]>;
      return {
        phrase: <>updated role {strong(String(meta.name))}</>,
        detail: Object.keys(changed).length > 0 ? roleUpdateDetail(changed) : undefined,
      };
    }
    case "role.delete":
      return { phrase: <>deleted role {strong(String(meta.name))}</> };
    case "role.reorder":
      return {
        phrase: (
          <>
            moved role {strong(String(meta.name))} from position{" "}
            {diff(String(meta.from), String(meta.to))}
          </>
        ),
      };
    case "role.assign":
      return {
        phrase: (
          <>
            assigned {strong(String(meta.name))} to {target(entry)}
          </>
        ),
      };
    case "role.unassign":
      return {
        phrase: (
          <>
            removed {strong(String(meta.name))} from {target(entry)}
          </>
        ),
      };
    case "channel.create":
      return {
        phrase: (
          <>
            created {String(meta.kind)} channel {strong(`#${String(meta.name)}`)}
          </>
        ),
      };
    case "channel.update": {
      const [oldName, newName] = (meta.name ?? []) as [unknown, unknown];
      return {
        phrase: (
          <>
            renamed channel {diff(strong(`#${String(oldName)}`), strong(`#${String(newName)}`))}
          </>
        ),
      };
    }
    case "channel.delete":
      return { phrase: <>deleted channel {strong(`#${String(meta.name)}`)}</> };
    case "guild.update": {
      const [oldName, newName] = (meta.name ?? []) as [unknown, unknown];
      return {
        phrase: (
          <>renamed the guild {diff(strong(String(oldName)), strong(String(newName)))}</>
        ),
      };
    }
    case "guild.transferOwnership":
      return { phrase: <>transferred ownership to {target(entry)}</> };
    case "invite.create":
      return {
        phrase: <>created invite {strong(String(meta.code))}</>,
        detail: meta.expiresAt ? (
          <>expires {new Date(String(meta.expiresAt)).toLocaleString()}</>
        ) : (
          <>never expires</>
        ),
      };
    case "invite.revoke":
      return { phrase: <>revoked invite {strong(String(meta.code))}</> };
    case "report.resolve":
      return { phrase: <>resolved a report</> };
    default:
      return { phrase: <>{String(entry.action)}</> };
  }
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { phrase, detail } = describeEntry(entry);
  const { icon: Icon, destructive } = styleFor(entry.action);
  const actor = displayName(entry.actor) ?? entry.actor.id;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
          destructive ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 text-sm">
            {strong(actor)} {phrase}
          </span>
          <span
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            title={entry.createdAt.toLocaleString()}
          >
            {relativeTime(entry.createdAt)}
          </span>
        </div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </li>
  );
}

/**
 * Read-only forensic view of the guild's privileged actions (VIEW_AUDIT_LOG). Fresh on
 * every open — `staleTime: 0` overrides the app default and there are no realtime events
 * for it; "Load older" pages by the ULID cursor.
 */
export function AuditLogSection({ guildId }: { guildId: string }) {
  const log = useInfiniteQuery({
    ...orpc.auditLog.list.infiniteOptions({
      input: auditLogInput(guildId),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }),
    staleTime: 0,
  });

  if (log.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!log.data) return null;

  const entries = log.data.pages.flatMap((page) => page.entries);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Privileged actions in this guild, newest first. Entries are permanent and outlive
        whatever they reference.
      </p>
      {entries.length > 0 ? (
        <ul className="flex flex-col divide-y divide-foreground/10">
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nothing logged yet.</p>
      )}
      {log.hasNextPage && (
        <Button
          size="xs"
          variant="outline"
          className="self-start"
          disabled={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          Load older
        </Button>
      )}
    </div>
  );
}
