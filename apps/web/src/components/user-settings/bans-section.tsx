import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { UserPickerList } from "@/components/dm/user-picker-list";
import type { UserSearchResult } from "@/lib/use-user-search";
import { useUserSearch } from "@/lib/use-user-search";
import { orpc, queryClient } from "@/utils/orpc";

/**
 * Instance bans (issue #63): ban form with a required reason — the reason is the ban's
 * sole paper trail (instance bans are deliberately not audit-logged) — and the
 * banned-users list with reasons + unban.
 */
export function BansSection() {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<UserSearchResult | null>(null);
  const [reason, setReason] = useState("");
  const search = useUserSearch(query);

  const listOptions = orpc.admin.listBannedUsers.queryOptions();
  const bannedUsers = useQuery(listOptions);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

  const banUser = useMutation(
    orpc.admin.banUser.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success(`Banned @${target?.username ?? "user"}.`);
        setTarget(null);
        setQuery("");
        setReason("");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const unbanUser = useMutation(
    orpc.admin.unbanUser.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Ban lifted.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const canBan = target !== null && reason.trim().length > 0 && !banUser.isPending;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground">
        Ban an account from this instance. The reason is required — it is the only record of
        why.
      </p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (target && reason.trim()) {
            banUser.mutate({ userId: target.id, reason: reason.trim() });
          }
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ban-target">Who</Label>
          {target ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Avatar
                seed={target.username ?? target.id}
                src={target.image}
                className="size-6"
              />
              <span className="text-sm">{target.displayName || target.username}</span>
              <span className="text-xs text-muted-foreground">@{target.username}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                className="ml-auto"
                aria-label="Clear selection"
                onClick={() => setTarget(null)}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="ban-target"
                placeholder="Search by name or @username"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query.trim().length > 0 && (
                <UserPickerList
                  query={query}
                  search={search}
                  recents={[]}
                  className="max-h-48"
                  onSelect={(user) => {
                    setTarget(user);
                    setQuery("");
                  }}
                />
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ban-reason">Reason</Label>
          <Input
            id="ban-reason"
            placeholder="Required"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div>
          <Button type="submit" variant="destructive" disabled={!canBan}>
            {banUser.isPending ? "Banning…" : "Ban from instance"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Banned users</p>
        {bannedUsers.isPending ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : bannedUsers.data && bannedUsers.data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {bannedUsers.data.map((bannedUser) => (
              <li key={bannedUser.id} className="flex items-center gap-3 py-2">
                <Avatar
                  seed={bannedUser.username ?? bannedUser.id}
                  src={bannedUser.image}
                  className="size-7 shrink-0"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">
                    {bannedUser.displayName || bannedUser.username}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      @{bannedUser.username}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {bannedUser.banReason}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  disabled={unbanUser.isPending}
                  onClick={() => unbanUser.mutate({ userId: bannedUser.id })}
                >
                  Unban
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No one is banned.</p>
        )}
      </div>
    </div>
  );
}
