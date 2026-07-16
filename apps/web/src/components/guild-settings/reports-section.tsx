import type { AppRouterClient } from "@konus-la/api/routers/index";
import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { relativeTime } from "@/lib/relative-time";
import { orpc } from "@/utils/orpc";

type ReportRow = Awaited<ReturnType<AppRouterClient["report"]["list"]>>[number];

function displayName(user: { username: string | null; displayName: string | null } | null) {
  return user?.displayName || user?.username || "a deleted account";
}

function ReportItem({ guildId, report }: { guildId: string; report: ReportRow }) {
  const resolved = report.resolvedAt !== null;
  // No cache writes here: the resolver receives their own `report.changed`, and the
  // dispatcher's invalidation is what greys the row and drops the badge — same
  // event-driven path every other mod's client takes.
  const resolve = useMutation(
    orpc.report.resolve.mutationOptions({
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <li className={cn("flex items-start gap-3 py-3", resolved && "opacity-60")}>
      <Avatar
        seed={report.messageAuthor?.username ?? report.messageAuthor?.id ?? "?"}
        src={report.messageAuthor?.image ?? null}
        className="mt-0.5 size-7 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            {displayName(report.messageAuthor)}
          </span>
          <span
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            title={report.createdAt.toLocaleString()}
          >
            {relativeTime(report.createdAt)}
          </span>
        </div>
        {/* The snapshot, not the live message — it outlives deletion. */}
        <p className="line-clamp-3 text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {report.messageContent}
        </p>
        <p className="text-xs text-muted-foreground">
          Reported by <span className="font-medium">{displayName(report.reporter)}</span> —{" "}
          {report.reason}
        </p>
        {resolved && (
          <p className="text-xs text-muted-foreground">
            Resolved by <span className="font-medium">{displayName(report.resolvedBy)}</span>
            {report.resolvedAt && ` · ${relativeTime(report.resolvedAt)}`}
          </p>
        )}
      </div>
      {!resolved && (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={resolve.isPending}
          onClick={() => resolve.mutate({ guildId, reportId: report.id })}
        >
          Resolve
        </Button>
      )}
    </li>
  );
}

/**
 * The guild's report inbox (MANAGE_REPORTS): every report carries the message snapshot,
 * author, reporter, and time. Resolving marks the report — nothing happens to the message
 * or its author — and greys the row; resolved reports live under the toggle at the bottom.
 * Live updates ride `report.changed` invalidation, so two moderators stay in sync.
 */
export function ReportsSection({ guildId }: { guildId: string }) {
  const [showResolved, setShowResolved] = useState(false);
  const reports = useQuery(orpc.report.list.queryOptions({ input: { guildId } }));

  if (reports.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (!reports.data) return null;

  const unresolved = reports.data.filter((report) => report.resolvedAt === null);
  const resolved = reports.data.filter((report) => report.resolvedAt !== null);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Messages members reported, newest first. Reports keep their snapshot even after the
        message is deleted; resolving only marks them handled.
      </p>

      {unresolved.length > 0 ? (
        <ul className="flex flex-col divide-y divide-foreground/10">
          {unresolved.map((report) => (
            <ReportItem key={report.id} guildId={guildId} report={report} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No unresolved reports.</p>
      )}

      {resolved.length > 0 && (
        <>
          <button
            type="button"
            className="mt-2 flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
            Resolved ({resolved.length})
          </button>
          {showResolved && (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {resolved.map((report) => (
                <ReportItem key={report.id} guildId={guildId} report={report} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
