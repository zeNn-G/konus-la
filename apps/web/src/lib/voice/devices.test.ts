import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DeviceManager,
  type DeviceManagerDeps,
  type DeviceNotice,
  type EnumeratedDevice,
  effectiveMicDeviceId,
  micProcessing,
  parseProcessingPref,
  parseVolumePref,
  useDeviceStore,
} from "./devices";

/**
 * The device-UX seam (#25): preferences vs presence. The manager watches `devicechange`,
 * keeps the persisted selection untouched, and announces the fallback/switch-back
 * transitions — the store's `sinkId`/`inputs`/`outputs` are what the UI consumes.
 */

/** Node has no localStorage — a Map-backed stand-in observes the persistence writes. */
function useFakeLocalStorage(): Map<string, string> {
  const stored = new Map<string, string>();
  beforeEach(() => {
    stored.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  return stored;
}

const MIC_DEFAULT: EnumeratedDevice = {
  deviceId: "default",
  kind: "audioinput",
  label: "Default - Built-in Microphone",
};
const MIC_USB: EnumeratedDevice = { deviceId: "mic-usb", kind: "audioinput", label: "USB Mic" };
const OUT_DEFAULT: EnumeratedDevice = {
  deviceId: "default",
  kind: "audiooutput",
  label: "Default - Speakers",
};
const OUT_HEADSET: EnumeratedDevice = {
  deviceId: "out-headset",
  kind: "audiooutput",
  label: "USB Headset",
};
const CAMERA: EnumeratedDevice = { deviceId: "cam-1", kind: "videoinput", label: "Webcam" };

class FakeDeps {
  devices: EnumeratedDevice[] = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT, OUT_HEADSET, CAMERA];
  notices: DeviceNotice[] = [];
  applyMicCalls = 0;
  outputSupported = true;
  sessionActive = true;
  listeners = new Set<() => void>();

  deps(): DeviceManagerDeps {
    return {
      enumerate: async () => this.devices,
      onDeviceChange: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      supportsOutput: () => this.outputSupported,
      sessionActive: () => this.sessionActive,
      applyMicDevice: async () => {
        this.applyMicCalls += 1;
      },
      notify: (notice) => {
        this.notices.push(notice);
      },
    };
  }
}

let fake: FakeDeps;
let manager: DeviceManager;

beforeEach(() => {
  useDeviceStore.setState({
    micId: null,
    speakerId: null,
    inputs: [],
    outputs: [],
    sinkId: "",
    outputSupported: false,
    outputVolume: 1,
    inputVolume: 1,
    agc: true,
    noiseSuppression: true,
    echoCancellation: true,
  });
  fake = new FakeDeps();
  manager = new DeviceManager(fake.deps());
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("start", () => {
  test("populates audio device lists and output support without announcing", async () => {
    await manager.start();

    const state = useDeviceStore.getState();
    expect(state.inputs.map((d) => d.deviceId)).toEqual(["default", "mic-usb"]);
    expect(state.outputs.map((d) => d.deviceId)).toEqual(["default", "out-headset"]);
    expect(state.outputSupported).toBe(true);
    expect(fake.notices).toEqual([]);
    expect(fake.applyMicCalls).toBe(0);
  });

  test("a persisted speaker selection becomes the sink once enumerated", async () => {
    useDeviceStore.setState({ speakerId: "out-headset" });
    await manager.start();
    expect(useDeviceStore.getState().sinkId).toBe("out-headset");
  });

  test("devicechange triggers a refresh", async () => {
    await manager.start();
    fake.devices = [MIC_DEFAULT, OUT_DEFAULT];
    for (const listener of fake.listeners) listener();
    await flush();
    expect(useDeviceStore.getState().inputs.map((d) => d.deviceId)).toEqual(["default"]);
  });
});

describe("selected mic unplug/replug", () => {
  beforeEach(async () => {
    useDeviceStore.setState({ micId: "mic-usb" });
    await manager.start();
  });

  test("unplug falls back to default: capture re-applied, toast, selection preserved", async () => {
    fake.devices = [MIC_DEFAULT, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();

    expect(fake.applyMicCalls).toBe(1);
    expect(fake.notices).toEqual([
      { kind: "input-fallback", toLabel: "Default - Built-in Microphone" },
    ]);
    // The persisted selection is NOT overwritten — replug switches back.
    expect(useDeviceStore.getState().micId).toBe("mic-usb");
    expect(effectiveMicDeviceId()).toBeUndefined();
  });

  test("replug switches back and announces the other direction", async () => {
    fake.devices = [MIC_DEFAULT, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();
    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();

    expect(fake.applyMicCalls).toBe(2);
    expect(fake.notices.at(-1)).toEqual({ kind: "input-restored", label: "USB Mic" });
    expect(effectiveMicDeviceId()).toBe("mic-usb");
  });

  test("unplugging a device that is not selected changes nothing", async () => {
    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT];
    await manager.refresh();
    expect(fake.applyMicCalls).toBe(0);
    expect(fake.notices).toEqual([]);
  });

  test("without a live session the fallback still applies but stays silent", async () => {
    fake.sessionActive = false;
    fake.devices = [MIC_DEFAULT, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();

    expect(fake.applyMicCalls).toBe(1);
    expect(fake.notices).toEqual([]);
    expect(effectiveMicDeviceId()).toBeUndefined();
  });
});

describe("selected output unplug/replug", () => {
  beforeEach(async () => {
    useDeviceStore.setState({ speakerId: "out-headset" });
    await manager.start();
  });

  test("unplug falls back to the default sink with a toast", async () => {
    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT];
    await manager.refresh();

    expect(useDeviceStore.getState().sinkId).toBe("");
    expect(fake.notices).toEqual([{ kind: "output-fallback", toLabel: "Default - Speakers" }]);
    expect(useDeviceStore.getState().speakerId).toBe("out-headset");
  });

  test("replug restores the sink and announces", async () => {
    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT];
    await manager.refresh();
    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();

    expect(useDeviceStore.getState().sinkId).toBe("out-headset");
    expect(fake.notices.at(-1)).toEqual({ kind: "output-restored", label: "USB Headset" });
  });
});

describe("output support feature-detect (Safari)", () => {
  test("unsupported output disables the section, the sink, and every output notice", async () => {
    fake.outputSupported = false;
    useDeviceStore.setState({ speakerId: "out-headset" });
    await manager.start();

    expect(useDeviceStore.getState().outputSupported).toBe(false);
    expect(useDeviceStore.getState().sinkId).toBe("");

    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT];
    await manager.refresh();
    fake.devices = [MIC_DEFAULT, MIC_USB, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();
    expect(fake.notices).toEqual([]);
    expect(useDeviceStore.getState().sinkId).toBe("");
  });
});

describe("preference setters", () => {
  test("setMicPreference records the choice and re-applies capture immediately", async () => {
    await manager.start();
    await manager.setMicPreference("mic-usb");

    expect(useDeviceStore.getState().micId).toBe("mic-usb");
    expect(effectiveMicDeviceId()).toBe("mic-usb");
    expect(fake.applyMicCalls).toBe(1);

    // The unplug of the freshly picked device is a fallback transition.
    fake.devices = [MIC_DEFAULT, OUT_DEFAULT, OUT_HEADSET];
    await manager.refresh();
    expect(fake.notices).toEqual([
      { kind: "input-fallback", toLabel: "Default - Built-in Microphone" },
    ]);
  });

  test("clearing the mic preference back to default re-applies without notices", async () => {
    useDeviceStore.setState({ micId: "mic-usb" });
    await manager.start();
    await manager.setMicPreference(null);

    expect(useDeviceStore.getState().micId).toBeNull();
    expect(effectiveMicDeviceId()).toBeUndefined();
    expect(fake.applyMicCalls).toBe(1);
    expect(fake.notices).toEqual([]);
  });

  test("setSpeakerPreference drives the sink only while the device is present", async () => {
    await manager.start();
    manager.setSpeakerPreference("out-headset");
    expect(useDeviceStore.getState().sinkId).toBe("out-headset");

    manager.setSpeakerPreference("out-gone");
    expect(useDeviceStore.getState().sinkId).toBe("");
  });
});

describe("master output volume (#78)", () => {
  const stored = useFakeLocalStorage();

  test("setOutputVolume updates the store and persists under voice:output-volume", () => {
    useDeviceStore.getState().setOutputVolume(0.4);

    expect(useDeviceStore.getState().outputVolume).toBe(0.4);
    expect(stored.get("voice:output-volume")).toBe("0.4");
  });

  test("out-of-range values clamp to 0..1", () => {
    useDeviceStore.getState().setOutputVolume(1.7);
    expect(useDeviceStore.getState().outputVolume).toBe(1);

    useDeviceStore.getState().setOutputVolume(-0.3);
    expect(useDeviceStore.getState().outputVolume).toBe(0);
  });

  test("hydration parsing: absent or garbage → default 1, valid values clamped", () => {
    expect(parseVolumePref(null)).toBe(1);
    expect(parseVolumePref("not-a-number")).toBe(1);
    expect(parseVolumePref("0.55")).toBe(0.55);
    expect(parseVolumePref("3")).toBe(1);
    expect(parseVolumePref("-1")).toBe(0);
  });
});

describe("mic input volume (#81)", () => {
  const stored = useFakeLocalStorage();

  test("setInputVolume updates the store and persists under voice:input-volume", () => {
    useDeviceStore.getState().setInputVolume(0.35);

    expect(useDeviceStore.getState().inputVolume).toBe(0.35);
    expect(stored.get("voice:input-volume")).toBe("0.35");
  });

  test("attenuation-only: values clamp to 0..1, gain never exceeds 1", () => {
    useDeviceStore.getState().setInputVolume(2.5);
    expect(useDeviceStore.getState().inputVolume).toBe(1);

    useDeviceStore.getState().setInputVolume(-0.5);
    expect(useDeviceStore.getState().inputVolume).toBe(0);
  });
});

describe("mic processing toggles (#81)", () => {
  const stored = useFakeLocalStorage();

  test("setMicProcessing persists each flag under its voice:* key and re-captures", async () => {
    await manager.start();

    await manager.setMicProcessing("agc", false);
    expect(useDeviceStore.getState().agc).toBe(false);
    expect(stored.get("voice:agc")).toBe("false");
    expect(fake.applyMicCalls).toBe(1);

    await manager.setMicProcessing("noiseSuppression", false);
    expect(stored.get("voice:noise-suppression")).toBe("false");

    await manager.setMicProcessing("echoCancellation", false);
    expect(stored.get("voice:echo-cancellation")).toBe("false");
    expect(fake.applyMicCalls).toBe(3);

    await manager.setMicProcessing("agc", true);
    expect(useDeviceStore.getState().agc).toBe(true);
    expect(stored.get("voice:agc")).toBe("true");
  });

  test("hydration parsing: only the literal \"false\" disables, everything else defaults on", () => {
    expect(parseProcessingPref(null)).toBe(true);
    expect(parseProcessingPref("false")).toBe(false);
    expect(parseProcessingPref("true")).toBe(true);
    expect(parseProcessingPref("garbage")).toBe(true);
  });

  test("micProcessing maps the store flags onto gUM constraint names", () => {
    useDeviceStore.setState({ agc: false, noiseSuppression: true, echoCancellation: false });
    expect(micProcessing()).toEqual({
      autoGainControl: false,
      noiseSuppression: true,
      echoCancellation: false,
    });
  });
});

describe("effectiveMicDeviceId", () => {
  test("no preference → undefined (system default)", () => {
    expect(effectiveMicDeviceId()).toBeUndefined();
  });

  test("preference trusted before the first enumerate", () => {
    useDeviceStore.setState({ micId: "mic-usb", inputs: [] });
    expect(effectiveMicDeviceId()).toBe("mic-usb");
  });

  test("preference absent from a known list → undefined", () => {
    useDeviceStore.setState({
      micId: "mic-usb",
      inputs: [{ deviceId: "default", label: "Default" }],
    });
    expect(effectiveMicDeviceId()).toBeUndefined();
  });
});
