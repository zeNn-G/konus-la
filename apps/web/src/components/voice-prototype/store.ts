// VOICE UX PROTOTYPE (wayfinder #10) — THROWAWAY. Fake in-memory voice state + ambient
// speaking simulator. No server, no persistence. Delete this folder after the variant decision.
import { useSyncExternalStore } from "react";

export type ProtoPeer = {
  id: string;
  seed: string;
  name: string;
  muted?: boolean;
  deafened?: boolean;
  camOn?: boolean;
  sharing?: boolean;
};

export type ProtoVoiceChannel = { id: string; name: string; peers: ProtoPeer[] };

export const PROTO_VOICE_CHANNELS: ProtoVoiceChannel[] = [
  {
    id: "proto-vc-lounge",
    name: "Lounge",
    peers: [
      { id: "p-maya", seed: "maya", name: "Maya", sharing: true },
      { id: "p-dax", seed: "dax", name: "Dax", camOn: true },
      { id: "p-ren", seed: "ren", name: "Ren", muted: true },
      { id: "p-kofi", seed: "kofi", name: "Kofi" },
    ],
  },
  {
    id: "proto-vc-warroom",
    name: "War Room",
    peers: [{ id: "p-suki", seed: "suki", name: "Suki", muted: true, deafened: true }],
  },
];

export const PROTO_INPUT_DEVICES = [
  "Default — Yeti Stereo Microphone",
  "Headset Microphone (USB Audio)",
  "Webcam C920 Microphone",
];
export const PROTO_OUTPUT_DEVICES = [
  "Default — Speakers (Realtek)",
  "HD 599 (USB Audio)",
  "LG Monitor (HDMI)",
];

export type VoiceProtoState = {
  joinedId: string | null;
  /** Variant A only: the room view is showing (vs connected-but-browsing-text). */
  roomOpen: boolean;
  selfMuted: boolean;
  selfDeafened: boolean;
  selfSharing: boolean;
  selfCamOn: boolean;
  speaking: ReadonlySet<string>;
  volumes: Readonly<Record<string, number>>;
  inputDevice: string;
  outputDevice: string;
};

let state: VoiceProtoState = {
  joinedId: null,
  roomOpen: false,
  selfMuted: false,
  selfDeafened: false,
  selfSharing: false,
  selfCamOn: false,
  speaking: new Set(),
  volumes: {},
  inputDevice: PROTO_INPUT_DEVICES[0]!,
  outputDevice: PROTO_OUTPUT_DEVICES[0]!,
};

const listeners = new Set<() => void>();

function emit(next: Partial<VoiceProtoState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

// Ambient speaking simulation — runs while anything subscribes, so sidebar rings
// animate even before you join.
let timer: ReturnType<typeof setInterval> | undefined;
function tick() {
  const pool = PROTO_VOICE_CHANNELS.flatMap((vc) =>
    vc.peers.filter((p) => !p.muted && !p.deafened).map((p) => p.id),
  );
  if (state.joinedId && !state.selfMuted && !state.selfDeafened) pool.push("self");
  const speaking = new Set<string>();
  for (const id of pool) if (Math.random() < 0.4) speaking.add(id);
  emit({ speaking });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) timer = setInterval(tick, 1100);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useVoiceProto(): VoiceProtoState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getProtoVc(id: string | null): ProtoVoiceChannel | undefined {
  return PROTO_VOICE_CHANNELS.find((vc) => vc.id === id);
}

export const voiceProto = {
  join: (id: string) => emit({ joinedId: id, roomOpen: true }),
  leave: () => emit({ joinedId: null, roomOpen: false, selfSharing: false, selfCamOn: false }),
  openRoom: () => emit({ roomOpen: true }),
  closeRoom: () => emit({ roomOpen: false }),
  toggleMute: () =>
    emit(
      state.selfDeafened
        ? { selfDeafened: false, selfMuted: false }
        : { selfMuted: !state.selfMuted },
    ),
  toggleDeafen: () =>
    state.selfDeafened
      ? emit({ selfDeafened: false })
      : emit({ selfDeafened: true, selfMuted: true }),
  toggleShare: () => emit({ selfSharing: !state.selfSharing }),
  toggleCam: () => emit({ selfCamOn: !state.selfCamOn }),
  setVolume: (peerId: string, value: number) =>
    emit({ volumes: { ...state.volumes, [peerId]: value } }),
  setInput: (device: string) => emit({ inputDevice: device }),
  setOutput: (device: string) => emit({ outputDevice: device }),
};
