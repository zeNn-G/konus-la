import type { AppRouterClient } from "@konus-la/api/routers/index";
import { Button } from "@konus-la/ui/components/button";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
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

function displayName(user: { username: string | null; displayName: string | null } | null) {
  return user?.displayName || user?.username || null;
}

const strong = (value: ReactNode) => <span className="font-medium">{value}</span>;

/** The target member's name; a deleted account falls back to its recorded id. */
function target(entry: AuditEntry): ReactNode {
  return strong(displayName(entry.targetUser) ?? entry.targetUserId ?? "someone");
}

const permissionLabels = new Map(
  PERMISSION_GROUPS.flatMap((group) => group.permissions).map((p) => [p.bit, p.label]),
);

/** `[old, new]` bitfields → "+Kick members · −Manage roles". */
function permissionDiff([oldBits, newBits]: [number, number]): string {
  const parts: string[] = [];
  for (const [bit, label] of permissionLabels) {
    if (newBits & bit && !(oldBits & bit)) parts.push(`+${label}`);
    if (oldBits & bit && !(newBits & bit)) parts.push(`−${label}`);
  }
  return parts.join(" · ");
}

function colorValue(color: unknown): ReactNode {
  if (typeof color !== "string") return "none";
  return (
    <span className="inline-flex items-baseline gap-1">
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
        <div>
          renamed {String(changed.name[0])} → {String(changed.name[1])}
        </div>
      )}
      {changed.color && (
        <div>
          color {colorValue(changed.color[0])} → {colorValue(changed.color[1])}
        </div>
      )}
      {changed.permissions && (
        <div>permissions {permissionDiff(changed.permissions as [number, number])}</div>
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
            moved role {strong(String(meta.name))} from position {String(meta.from)} to{" "}
            {String(meta.to)}
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
            renamed channel {strong(`#${String(oldName)}`)} → {strong(`#${String(newName)}`)}
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
          <>
            renamed the guild {strong(String(oldName))} → {strong(String(newName))}
          </>
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
  const actor = displayName(entry.actor) ?? entry.actor.id;
  return (
    <li className="flex flex-col gap-0.5 py-2">
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
          <Skeleton key={i} className="h-8 w-full" />
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
