import { describe, expect, test } from "vitest";

import { closeUserConnections, connectionClosed, connectionOpened } from "./connections";

/** Minimal stand-in for a Bun ServerWebSocket — the registry only ever calls close(). */
function fakeSocket() {
  return {
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

describe("closeUserConnections", () => {
  test("closes every registered socket of the user and only theirs", () => {
    const bannedTabA = fakeSocket();
    const bannedTabB = fakeSocket();
    const bystander = fakeSocket();
    connectionOpened("u-banned", bannedTabA);
    connectionOpened("u-banned", bannedTabB);
    connectionOpened("u-bystander", bystander);

    closeUserConnections("u-banned");

    expect(bannedTabA.closed).toBe(true);
    expect(bannedTabB.closed).toBe(true);
    expect(bystander.closed).toBe(false);

    connectionClosed("u-bystander", bystander);
  });

  test("a socket that already closed on its own is not force-closed later", () => {
    const departed = fakeSocket();
    const lingering = fakeSocket();
    connectionOpened("u-two-tabs", departed);
    connectionOpened("u-two-tabs", lingering);
    connectionClosed("u-two-tabs", departed);

    closeUserConnections("u-two-tabs");

    expect(departed.closed).toBe(false);
    expect(lingering.closed).toBe(true);
  });

  test("is idempotent — a user with no registered sockets is a no-op", () => {
    expect(() => closeUserConnections("u-unknown")).not.toThrow();

    const socket = fakeSocket();
    connectionOpened("u-repeat", socket);
    closeUserConnections("u-repeat");
    expect(() => closeUserConnections("u-repeat")).not.toThrow();
  });
});
