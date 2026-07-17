import { toast } from "sonner";
import { create } from "zustand";

/**
 * Device selection & `devicechange` UX (phase-5 spec §UX #17): selections are persisted
 * preferences, presence is what the browser currently enumerates, and the two never
 * overwrite each other — unplugging the chosen device falls back to the system default
 * while the preference stays put, so a replug switches right back. Both directions are
 * announced (toast), with a **Change** action that opens the deck's DevicePicker.
 *
 * Output (speaker) selection exists only where `setSinkId` does — Safari opts out
 * wholesale: no output section in the picker, no output toasts, sink always default.
 */

export type DeviceInfo = { deviceId: string; label: string };
export type EnumeratedDevice = { deviceId: string; kind: string; label: string };

export type DeviceNotice =
  | { kind: "input-fallback"; toLabel: string }
  | { kind: "input-restored"; label: string }
  | { kind: "output-fallback"; toLabel: string }
  | { kind: "output-restored"; label: string };

const MIC_STORAGE_KEY = "voice:mic-device";
const SPEAKER_STORAGE_KEY = "voice:speaker-device";
const OUTPUT_VOLUME_STORAGE_KEY = "voice:output-volume";

function loadPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistPreference(key: string, deviceId: string | null): void {
  try {
    if (deviceId === null) localStorage.removeItem(key);
    else localStorage.setItem(key, deviceId);
  } catch {
    // storage full/blocked — the selection still applies for this session
  }
}

function clamp01(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

/** Persisted master volume (0–1, default 1); absent or garbage falls back to 1 (#78). */
export function parseOutputVolume(raw: string | null): number {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? clamp01(parsed) : 1;
}

export interface DeviceStoreState {
  /** Persisted selections; null = system default. Never overwritten by a fallback. */
  micId: string | null;
  speakerId: string | null;
  /** What the browser currently enumerates (audio devices only). */
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
  /** Effective output sink for the audio bridge; "" = system default. */
  sinkId: string;
  /** Whether output selection exists at all on this browser. */
  outputSupported: boolean;
  /** The deck DevicePicker's open state — the fallback toast's Change action opens it. */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /**
   * Master output volume 0..1 governing ALL app audio (#78): the voice bridge multiplies
   * it into every element volume, the effects engine drives its master gain from it.
   * Persisted like the device selections — no cross-tab sync, drift is harmless.
   */
  outputVolume: number;
  setOutputVolume: (volume: number) => void;
}

export const useDeviceStore = create<DeviceStoreState>()((set) => ({
  micId: loadPreference(MIC_STORAGE_KEY),
  speakerId: loadPreference(SPEAKER_STORAGE_KEY),
  inputs: [],
  outputs: [],
  sinkId: "",
  outputSupported: false,
  pickerOpen: false,
  setPickerOpen: (open) => set({ pickerOpen: open }),
  outputVolume: parseOutputVolume(loadPreference(OUTPUT_VOLUME_STORAGE_KEY)),
  setOutputVolume: (volume) => {
    const clamped = clamp01(volume);
    persistPreference(OUTPUT_VOLUME_STORAGE_KEY, String(clamped));
    set({ outputVolume: clamped });
  },
}));

/**
 * The mic deviceId `getUserMedia` should ask for right now: the preference while it is
 * (believed) present, otherwise the system default. Before the first enumerate the
 * preference is trusted — capture uses `ideal`, which cannot throw on a stale id.
 */
export function effectiveMicDeviceId(): string | undefined {
  const { micId, inputs } = useDeviceStore.getState();
  if (micId === null) return undefined;
  if (inputs.length === 0) return micId;
  return inputs.some((device) => device.deviceId === micId) ? micId : undefined;
}

export interface DeviceManagerDeps {
  enumerate: () => Promise<EnumeratedDevice[]>;
  /** Subscribe to `devicechange`; returns an unsubscribe. */
  onDeviceChange: (listener: () => void) => () => void;
  supportsOutput: () => boolean;
  /** Announcements only make sense mid-call. */
  sessionActive: () => boolean;
  /** Re-capture the mic on the current effective device and swap the producer track. */
  applyMicDevice: () => Promise<void>;
  notify: (notice: DeviceNotice) => void;
}

function toInfo(devices: EnumeratedDevice[]): DeviceInfo[] {
  return devices.map(({ deviceId, label }) => ({ deviceId, label }));
}

/** Presence of a *preference* in an enumeration; null (system default) is never "present". */
function hasDevice(devices: ReadonlyArray<{ deviceId: string }>, deviceId: string | null): boolean {
  return deviceId !== null && devices.some((device) => device.deviceId === deviceId);
}

/** The label a fallback lands on — the browser's "default" entry, else the first device. */
function defaultLabel(devices: EnumeratedDevice[]): string {
  const label =
    devices.find((device) => device.deviceId === "default")?.label ?? devices[0]?.label;
  return label || "system default";
}

function labelOf(devices: EnumeratedDevice[], deviceId: string): string {
  return devices.find((device) => device.deviceId === deviceId)?.label || "selected device";
}

export class DeviceManager {
  private started = false;
  /** Presence of the *preferred* devices at the last refresh — the transition memory. */
  private micPresent = false;
  private speakerPresent = false;
  /** Serializes refreshes — `devicechange` fires in bursts. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private deps: DeviceManagerDeps) {}

  /** Idempotent; wires `devicechange` and does a silent initial enumerate. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.deps.onDeviceChange(() => void this.refresh());
    // Initial enumerate only seeds the presence memory — nothing to fall back FROM yet.
    await this.enqueue(() => this.doRefresh({ reactToTransitions: false }));
  }

  /** Re-enumerate and act on presence transitions (also called on picker open). */
  refresh(): Promise<void> {
    return this.enqueue(() => this.doRefresh({ reactToTransitions: true }));
  }

  /** Pick a mic (null = system default): persist, then re-capture on it right away. */
  async setMicPreference(deviceId: string | null): Promise<void> {
    persistPreference(MIC_STORAGE_KEY, deviceId);
    this.micPresent = hasDevice(useDeviceStore.getState().inputs, deviceId);
    useDeviceStore.setState({ micId: deviceId });
    await this.deps.applyMicDevice();
  }

  /** Pick an output (null = system default): the sink follows while it is present. */
  setSpeakerPreference(deviceId: string | null): void {
    persistPreference(SPEAKER_STORAGE_KEY, deviceId);
    const present = hasDevice(useDeviceStore.getState().outputs, deviceId);
    this.speakerPresent = present;
    useDeviceStore.setState({ speakerId: deviceId, sinkId: present && deviceId ? deviceId : "" });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work);
    this.queue = next;
    return next;
  }

  private async doRefresh({ reactToTransitions }: { reactToTransitions: boolean }): Promise<void> {
    const devices = await this.deps.enumerate();
    // Pre-permission enumerations yield placeholder entries with empty ids — skip them.
    const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "");
    const outputs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId !== "");
    const outputSupported = this.deps.supportsOutput();
    const { micId, speakerId } = useDeviceStore.getState();

    const micPresent = hasDevice(inputs, micId);
    const speakerPresent = outputSupported && hasDevice(outputs, speakerId);
    const micChanged = micPresent !== this.micPresent;
    const speakerChanged = speakerPresent !== this.speakerPresent;
    this.micPresent = micPresent;
    this.speakerPresent = speakerPresent;

    useDeviceStore.setState({
      inputs: toInfo(inputs),
      outputs: toInfo(outputs),
      outputSupported,
      sinkId: speakerPresent && speakerId !== null ? speakerId : "",
    });
    if (!reactToTransitions) return;

    const announce = this.deps.sessionActive();
    if (micId !== null && micChanged) {
      void this.deps.applyMicDevice();
      if (announce) {
        this.deps.notify(
          micPresent
            ? { kind: "input-restored", label: labelOf(inputs, micId) }
            : { kind: "input-fallback", toLabel: defaultLabel(inputs) },
        );
      }
    }
    if (outputSupported && speakerId !== null && speakerChanged && announce) {
      this.deps.notify(
        speakerPresent
          ? { kind: "output-restored", label: labelOf(outputs, speakerId) }
          : { kind: "output-fallback", toLabel: defaultLabel(outputs) },
      );
    }
  }
}

// --- the real browser half ---------------------------------------------------------------

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|edg|android/i.test(ua);
}

const NOTICE_COPY: Record<DeviceNotice["kind"], (name: string) => string> = {
  "input-fallback": (name) => `Mic disconnected — switched to ${name}`,
  "input-restored": (name) => `${name} reconnected — switched back`,
  "output-fallback": (name) => `Audio output disconnected — switched to ${name}`,
  "output-restored": (name) => `${name} reconnected — switched back`,
};

/** Everything but the two session-coupled deps — session.ts wires those (no import cycle). */
export function createRealDeviceDeps(): Omit<
  DeviceManagerDeps,
  "sessionActive" | "applyMicDevice"
> {
  return {
    enumerate: async () =>
      (await navigator.mediaDevices.enumerateDevices()).map(({ deviceId, kind, label }) => ({
        deviceId,
        kind,
        label,
      })),
    onDeviceChange: (listener) => {
      navigator.mediaDevices.addEventListener("devicechange", listener);
      return () => navigator.mediaDevices.removeEventListener("devicechange", listener);
    },
    supportsOutput: () =>
      typeof HTMLMediaElement !== "undefined" &&
      "setSinkId" in HTMLMediaElement.prototype &&
      !isSafari(),
    notify: (notice) => {
      const name = "toLabel" in notice ? notice.toLabel : notice.label;
      const message = NOTICE_COPY[notice.kind](name);
      if (notice.kind === "input-fallback" || notice.kind === "output-fallback") {
        toast(message, {
          action: {
            label: "Change",
            onClick: () => useDeviceStore.getState().setPickerOpen(true),
          },
        });
      } else {
        toast(message);
      }
    },
  };
}
