import { describe, expect, test, vi } from "vitest";

import { attachSessionWatchdog, type SessionWatchdogDeps } from "./session-watchdog";

/**
 * The watchdog seam: a fake socket stands in for the shared /ws ReconnectingWebSocket and
 * the deps stand in for authClient.getSession / the hard navigation. Everything asserted
 * here is the zombie-tab contract (phase-6 spec §Instance-ban sign-in & session-death UX):
 * a socket drop triggers a session re-check, and ONLY a definitive "session gone" answer
 * navigates to /login.
 */

class FakeSocket {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function setup(getSession: SessionWatchdogDeps["getSession"]) {
  const socket = new FakeSocket();
  const navigateToLogin = vi.fn();
  attachSessionWatchdog(socket, { getSession, navigateToLogin });
  return { socket, navigateToLogin };
}

/** Flush the microtask chain the watchdog's async check rides on. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("session watchdog", () => {
  test("socket close with a dead session navigates to /login", async () => {
    const { socket, navigateToLogin } = setup(async () => ({ data: null, error: null }));

    socket.emit("close");
    await settle();

    expect(navigateToLogin).toHaveBeenCalledTimes(1);
  });

  test("socket close with a still-valid session does not navigate", async () => {
    const { socket, navigateToLogin } = setup(async () => ({
      data: { user: { id: "u1" } },
      error: null,
    }));

    socket.emit("close");
    await settle();

    expect(navigateToLogin).not.toHaveBeenCalled();
  });

  test("a failed session check (network down) counts as transient — no navigation", async () => {
    const { socket, navigateToLogin } = setup(async () => ({
      data: null,
      error: { status: 0, message: "Failed to fetch" },
    }));

    socket.emit("close");
    await settle();

    expect(navigateToLogin).not.toHaveBeenCalled();
  });

  test("drops during an in-flight check collapse into it — one getSession per burst", async () => {
    let resolveCheck!: (result: { data: unknown; error: unknown }) => void;
    const getSession = vi.fn(
      () =>
        new Promise<{ data: unknown; error: unknown }>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const { socket, navigateToLogin } = setup(getSession);

    socket.emit("close");
    socket.emit("close");
    socket.emit("close");
    await settle();
    expect(getSession).toHaveBeenCalledTimes(1);

    resolveCheck({ data: { user: { id: "u1" } }, error: null });
    await settle();
    expect(navigateToLogin).not.toHaveBeenCalled();

    // The burst is over; the NEXT drop checks again.
    socket.emit("close");
    await settle();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  test("after navigating, further drops neither re-check nor navigate again", async () => {
    const getSession = vi.fn(async () => ({ data: null, error: null }));
    const { socket, navigateToLogin } = setup(getSession);

    socket.emit("close");
    await settle();
    expect(navigateToLogin).toHaveBeenCalledTimes(1);

    socket.emit("close");
    await settle();

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(navigateToLogin).toHaveBeenCalledTimes(1);
  });

  test("socket error events also trigger the check (connect-timeout path fires no close)", async () => {
    const { socket, navigateToLogin } = setup(async () => ({ data: null, error: null }));

    socket.emit("error");
    await settle();

    expect(navigateToLogin).toHaveBeenCalledTimes(1);
  });
});
