import { useEffect } from "react";

/**
 * The channel-in-view signal (#75): which channel's conversation is on screen right now.
 * The guild-channel and DM routes write it in pathname-keyed mount/unmount effects; the
 * notification dispatcher reads it synchronously — no router parsing in the dispatcher.
 */

let activeChannelId: string | null = null;

export function getActiveChannelId(): string | null {
  return activeChannelId;
}

export function setActiveChannel(channelId: string): void {
  activeChannelId = channelId;
}

/**
 * Conditional on the caller's id: an unmount cleanup that fires after the next route
 * already claimed the slot must not wipe the newer claim.
 */
export function clearActiveChannel(channelId: string): void {
  if (activeChannelId === channelId) activeChannelId = null;
}

/** The routes' write path — one pathname-keyed effect shared by every channel view. */
export function useActiveChannel(channelId: string): void {
  useEffect(() => {
    setActiveChannel(channelId);
    return () => clearActiveChannel(channelId);
  }, [channelId]);
}
