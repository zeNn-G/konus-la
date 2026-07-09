import { Avatar } from "@konus-la/ui/components/avatar";
import { Skeleton } from "@konus-la/ui/components/skeleton";
import { cn } from "@konus-la/ui/lib/utils";

import type { UserSearch, UserSearchResult } from "@/lib/use-user-search";
import { USER_SEARCH_LIMIT } from "@/lib/use-user-search";

const RECENTS_SHOWN = 8;

/**
 * Shared people-picker list for the DM dialogs and add-people popover: recent contacts
 * before typing, skeletons on the first search, dimmed stale results while a refinement
 * settles, and a truncation footer when a full page comes back. All states render inside
 * one fixed-size box — pass a height (`h-*`) via `className` so switching states never
 * resizes the surrounding dialog.
 */
export function UserPickerList({
  query,
  search,
  recents,
  excludeIds,
  onSelect,
  disabled = false,
  className,
}: {
  query: string;
  search: UserSearch;
  recents: UserSearchResult[];
  excludeIds?: Set<string>;
  onSelect: (user: UserSearchResult) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <PickerState
        query={query}
        search={search}
        recents={recents}
        excludeIds={excludeIds}
        onSelect={onSelect}
        disabled={disabled}
      />
    </div>
  );
}

function PickerState({
  query,
  search,
  recents,
  excludeIds,
  onSelect,
  disabled,
}: {
  query: string;
  search: UserSearch;
  recents: UserSearchResult[];
  excludeIds?: Set<string>;
  onSelect: (user: UserSearchResult) => void;
  disabled: boolean;
}) {
  const visible = (users: UserSearchResult[]) =>
    excludeIds ? users.filter((user) => !excludeIds.has(user.id)) : users;

  if (query.trim().length === 0) {
    const shown = visible(recents).slice(0, RECENTS_SHOWN);
    // No hint line — the input placeholder already says what to type.
    if (shown.length === 0) {
      return null;
    }
    return (
      <>
        <p className="px-2 text-xs font-medium text-muted-foreground">Recent</p>
        <UserRows users={shown} onSelect={onSelect} disabled={disabled} />
      </>
    );
  }

  if (search.isSearching) {
    return (
      <ul aria-hidden className="flex flex-col gap-0.5">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-2 px-2 py-1.5">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3.5 w-32 rounded" />
          </li>
        ))}
      </ul>
    );
  }

  const candidates = visible(search.results);
  if (candidates.length === 0) {
    return <Hint>No matches for “{query.trim()}”. Check the spelling or try another name.</Hint>;
  }

  return (
    <>
      <UserRows
        users={candidates}
        onSelect={onSelect}
        disabled={disabled}
        className={cn(search.isRefining && "opacity-60")}
      />
      {search.truncated && (
        <p className="px-2 text-xs text-muted-foreground">
          Showing first {USER_SEARCH_LIMIT} — keep typing to narrow.
        </p>
      )}
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-xs text-muted-foreground">{children}</p>;
}

function UserRows({
  users,
  onSelect,
  disabled,
  className,
}: {
  users: UserSearchResult[];
  onSelect: (user: UserSearchResult) => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("flex min-h-0 flex-col gap-0.5 overflow-y-auto", className)}>
      {users.map((user) => (
        <li key={user.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
            disabled={disabled}
            onClick={() => onSelect(user)}
          >
            <Avatar seed={user.username ?? user.id} src={user.image} className="size-6" />
            <span>{user.displayName || user.username}</span>
            <span className="text-xs text-muted-foreground">@{user.username}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
