import { authClient } from "@/lib/auth-client";

/**
 * Zombie-tab fix (phase-6 spec §Instance-ban sign-in & session-death UX): the /ws upgrade
 * requires a live session, so once the session dies every reconnect attempt fails and the
 * tab would otherwise sit connected-looking forever. Each socket drop triggers a session
 * re-check; a definitive "gone" hard-navigates to /login (the sign-out mechanism). The
 * check — not the drop — gates the navigation, so transient network loss with a valid
 * session never logs anyone out, and an unreachable server (check itself fails) counts as
 * transient too. No cause messaging by design: the sign-in attempt is where the
 * explanation lives.
 */

type SocketLike = {
  addEventListener(type: "close" | "error", listener: () => void): void;
};

export type SessionWatchdogDeps = {
  /** authClient.getSession shape: null data + null error is the definitive "gone". */
  getSession: () => Promise<{ data: unknown; error: unknown }>;
  navigateToLogin: () => void;
};

const defaultDeps: SessionWatchdogDeps = {
  getSession: () => authClient.getSession(),
  navigateToLogin: () => {
    window.location.href = "/login";
  },
};

export function attachSessionWatchdog(socket: SocketLike, deps = defaultDeps): void {
  // A reconnect storm fires one close per failed attempt; drops during an in-flight
  // check collapse into it, so the check cadence is bounded by the retry backoff.
  // Navigating latches the watchdog: the page is on its way out, so later drops of the
  // dying socket must not re-check or re-navigate.
  let checking = false;
  let navigated = false;
  const check = async () => {
    if (checking || navigated) return;
    checking = true;
    try {
      const { data, error } = await deps.getSession();
      if (data === null && error === null) {
        navigated = true;
        deps.navigateToLogin();
      }
    } finally {
      checking = false;
    }
  };
  socket.addEventListener("close", () => void check());
  // partysocket's connect-timeout path dispatches only `error` (ws.js _handleError), so
  // `close` alone would miss it; the in-flight collapse absorbs the usual error+close pair.
  socket.addEventListener("error", () => void check());
}
