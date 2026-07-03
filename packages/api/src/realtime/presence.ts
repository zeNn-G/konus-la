import { listCoMemberUserIds } from "@konus-la/db";

import { publishTo } from "./publishers";

/**
 * Binary online/offline presence, derived purely from open-WS counts — no DB rows.
 * Lives here (not apps/server) because `realtime.events` reads the snapshot at subscribe
 * time; the socket layer just calls the two connection hooks. Offline is debounced 5 s so
 * a page refresh never flaps; during the debounce window the user still counts as online.
 *
 * Dev note: `bun --hot` resets this module state — presence looks empty until sockets reconnect.
 */

const OFFLINE_DEBOUNCE_MS = 5_000;

const connectionCounts = new Map<string, number>();
const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function isOnline(userId: string): boolean {
  return connectionCounts.has(userId) || offlineTimers.has(userId);
}

/** Socket opened (already authenticated). Broadcasts online only on a true offline→online edge. */
export async function presenceConnectionOpened(userId: string): Promise<void> {
  const count = (connectionCounts.get(userId) ?? 0) + 1;
  connectionCounts.set(userId, count);

  const pendingOffline = offlineTimers.get(userId);
  if (pendingOffline) {
    // Reconnected within the debounce window — never went offline, nothing to announce.
    clearTimeout(pendingOffline);
    offlineTimers.delete(userId);
    return;
  }
  if (count === 1) {
    await publishTo(await listCoMemberUserIds(userId), {
      type: "presence.update",
      userId,
      online: true,
    });
  }
}

/** Socket closed. On the last connection, start the debounced offline broadcast. */
export function presenceConnectionClosed(userId: string): void {
  const count = connectionCounts.get(userId) ?? 0;
  if (count <= 1) {
    connectionCounts.delete(userId);
    if (count === 0) return; // spurious close for a user we never counted
    const timer = setTimeout(() => {
      offlineTimers.delete(userId);
      if (connectionCounts.has(userId)) return; // reconnected while the query was pending
      void listCoMemberUserIds(userId).then((coMembers) =>
        publishTo(coMembers, { type: "presence.update", userId, online: false }),
      );
    }, OFFLINE_DEBOUNCE_MS);
    offlineTimers.set(userId, timer);
    return;
  }
  connectionCounts.set(userId, count - 1);
}

/** Online users among those sharing a guild with `userId` (the subscriber itself excluded). */
export async function presenceSnapshotFor(userId: string): Promise<string[]> {
  const coMembers = await listCoMemberUserIds(userId);
  return coMembers.filter(isOnline);
}
