/**
 * Registry of a user's live websocket handles (phase-6 spec §admin router, #50). The
 * presence pattern — the socket layer calls the two connection hooks — but where presence
 * tracks counts, this holds the actual sockets so `admin.banUser` can force-close them.
 * Closing lands each tab on the reconnect path, whose session re-check (#62) walks the
 * banned user to /login.
 *
 * Dev note: `bun --hot` resets this module state — sockets registered before a reload
 * can't be force-closed until they reconnect.
 */

/** The one capability the registry needs; satisfied by Bun's ServerWebSocket. */
type CloseableSocket = { close(code?: number, reason?: string): void };

const socketsByUser = new Map<string, Set<CloseableSocket>>();

/** Socket opened (already authenticated). */
export function connectionOpened(userId: string, socket: CloseableSocket): void {
  let sockets = socketsByUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(userId, sockets);
  }
  sockets.add(socket);
}

/** Socket closed (any cause — including a force-close below re-entering via the close hook). */
export function connectionClosed(userId: string, socket: CloseableSocket): void {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) socketsByUser.delete(userId);
}

/** Force-close every registered socket of the user. Idempotent — no sockets is a no-op. */
export function closeUserConnections(userId: string): void {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  // Drop the entry first: each close() re-enters connectionClosed via the socket's close
  // hook, which must find nothing left to touch.
  socketsByUser.delete(userId);
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      // one broken socket must not shield the rest from closing
    }
  }
}
