import { beforeEach, describe, expect, test } from "vitest";

import { clearActiveChannel, getActiveChannelId, setActiveChannel } from "./active-channel";

/**
 * The channel-in-view signal (#75): the guild-channel and DM routes write it in
 * pathname-keyed mount/unmount effects; the dispatcher reads it synchronously.
 */

beforeEach(() => {
  clearActiveChannel(getActiveChannelId() ?? "");
});

describe("active-channel store", () => {
  test("starts empty and reflects the last set", () => {
    expect(getActiveChannelId()).toBeNull();
    setActiveChannel("channel-a");
    expect(getActiveChannelId()).toBe("channel-a");
    setActiveChannel("channel-b");
    expect(getActiveChannelId()).toBe("channel-b");
  });

  test("clear removes the channel it names", () => {
    setActiveChannel("channel-a");
    clearActiveChannel("channel-a");
    expect(getActiveChannelId()).toBeNull();
  });

  test("a stale clear (old route unmounting after the next one mounted) is a no-op", () => {
    setActiveChannel("channel-b");
    clearActiveChannel("channel-a");
    expect(getActiveChannelId()).toBe("channel-b");
  });
});
