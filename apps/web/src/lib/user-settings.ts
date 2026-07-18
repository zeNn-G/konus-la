import { create } from "zustand";

/**
 * User-settings dialog state: open + active section in a module store so non-React call
 * sites can open the dialog at a section. Every open names its section — there is no
 * bare `open()`.
 */

export type UserSettingsSection = "profile" | "voice" | "codes" | "bans";

interface UserSettingsState {
  open: boolean;
  section: UserSettingsSection;
  openAt: (section: UserSettingsSection) => void;
  close: () => void;
}

export const useUserSettings = create<UserSettingsState>()((set) => ({
  open: false,
  section: "profile",
  openAt: (section) => set({ open: true, section }),
  close: () => set({ open: false, section: "profile" }),
}));
