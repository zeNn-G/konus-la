import { useState } from "react";

const KEY = "konus.members-panel-open";

/**
 * Global desktop preference for the channel members panel — one key for the whole app,
 * default open. Mobile ignores this (the panel is an on-demand sheet there).
 */
export function useMembersPanelPref(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => localStorage.getItem(KEY) !== "false");

  const setAndPersist = (next: boolean) => {
    setOpen(next);
    localStorage.setItem(KEY, String(next));
  };

  return [open, setAndPersist];
}
