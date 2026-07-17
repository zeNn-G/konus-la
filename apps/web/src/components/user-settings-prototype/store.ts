// PROTOTYPE — THROWAWAY (wayfinder ticket #77). All state is in-memory; nothing
// persists, nothing mutates the server. The store also carries the dialog's open
// state so UserCard and ControlDeck can open it without prop-drilling.

import { create } from "zustand";

export type SettingsSection = "profile" | "voice" | "notifications";

export type SoundKey =
  | "notificationPing"
  | "selfJoin"
  | "selfLeave"
  | "muteToggle"
  | "deafenToggle"
  | "peerJoinLeave";

export const SOUND_LABELS: { key: SoundKey; label: string }[] = [
  { key: "notificationPing", label: "Notification ping" },
  { key: "selfJoin", label: "You join a voice room" },
  { key: "selfLeave", label: "You leave / disconnect" },
  { key: "muteToggle", label: "Mute on / off" },
  { key: "deafenToggle", label: "Deafen on / off" },
  { key: "peerJoinLeave", label: "Someone joins or leaves your room" },
];

/** Fake device lists so the pickers render without a getUserMedia permission dance. */
export const FAKE_INPUTS = ["Blue Yeti", "Webcam microphone"];
export const FAKE_OUTPUTS = ["Speakers (Realtek HD)", "HD 600 headphones"];

export type DmDefault = "all" | "muted";
export type GuildDefault = "all" | "mentions" | "muted";

interface PrototypeState {
  open: boolean;
  section: SettingsSection;
  openAt: (section: SettingsSection) => void;
  close: () => void;

  displayName: string;
  setDisplayName: (name: string) => void;

  micChoice: string | null; // null = system default
  speakerChoice: string | null;
  setMicChoice: (id: string | null) => void;
  setSpeakerChoice: (id: string | null) => void;

  masterVolume: number;
  setMasterVolume: (v: number) => void;
  soundsEnabled: boolean;
  setSoundsEnabled: (on: boolean) => void;
  soundVolume: number;
  setSoundVolume: (v: number) => void;
  sounds: Record<SoundKey, boolean>;
  toggleSound: (key: SoundKey) => void;

  dmDefault: DmDefault;
  setDmDefault: (v: DmDefault) => void;
  guildDefault: GuildDefault;
  setGuildDefault: (v: GuildDefault) => void;
  notificationSounds: boolean;
  setNotificationSounds: (on: boolean) => void;
}

export const usePrototypeStore = create<PrototypeState>()((set) => ({
  open: false,
  section: "profile",
  openAt: (section) => set({ open: true, section }),
  close: () => set({ open: false }),

  displayName: "",
  setDisplayName: (displayName) => set({ displayName }),

  micChoice: null,
  speakerChoice: null,
  setMicChoice: (micChoice) => set({ micChoice }),
  setSpeakerChoice: (speakerChoice) => set({ speakerChoice }),

  masterVolume: 80,
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  soundsEnabled: true,
  setSoundsEnabled: (soundsEnabled) => set({ soundsEnabled }),
  soundVolume: 60,
  setSoundVolume: (soundVolume) => set({ soundVolume }),
  sounds: {
    notificationPing: true,
    selfJoin: true,
    selfLeave: true,
    muteToggle: true,
    deafenToggle: true,
    peerJoinLeave: true,
  },
  toggleSound: (key) =>
    set((state) => ({ sounds: { ...state.sounds, [key]: !state.sounds[key] } })),

  dmDefault: "all",
  setDmDefault: (dmDefault) => set({ dmDefault }),
  guildDefault: "mentions",
  setGuildDefault: (guildDefault) => set({ guildDefault }),
  notificationSounds: true,
  setNotificationSounds: (notificationSounds) => set({ notificationSounds }),
}));

/** Throwaway blip so sound toggles/previews feel real — a 120 ms sine at the sound volume. */
export function playBlip(pitch = 660): void {
  const { soundVolume, masterVolume } = usePrototypeStore.getState();
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = pitch;
    gain.gain.value = 0.15 * (soundVolume / 100) * (masterVolume / 100);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close();
  } catch {
    // no audio in this environment — the preview is best-effort
  }
}
