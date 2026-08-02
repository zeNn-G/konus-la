import { Button } from "@konus-la/ui/components/button";
import { Label } from "@konus-la/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@konus-la/ui/components/select";
import { Slider } from "@konus-la/ui/components/slider";
import { Switch } from "@konus-la/ui/components/switch";
import { PlayIcon } from "lucide-react";
import { useEffect } from "react";

import {
  isSoundCueEnabled,
  previewSoundCue,
  useSoundPrefs,
  type SoundCue,
} from "@/lib/sound-effects";
import {
  supportsDtln,
  useDeviceStore,
  type DeviceInfo,
  type MicProcessingSetting,
  type NoiseSuppressionMode,
} from "@/lib/voice/devices";
import { deviceManager } from "@/lib/voice/session";

/**
 * The dialog's Voice section (#85, Discord Voice-Settings layout): input/output device
 * dropdowns side by side, a volume slider under each column — input drives the mic
 * chain's gain live (#81), output is the master volume (#78) — the mic processing
 * toggles under the input column, and the voice-sound toggles below. Where output
 * selection doesn't exist (Safari) the output dropdown is silently absent — no
 * explanatory copy, sink stays system default.
 */
export function VoiceSection() {
  const inputs = useDeviceStore((s) => s.inputs);
  const outputs = useDeviceStore((s) => s.outputs);
  const micId = useDeviceStore((s) => s.micId);
  const speakerId = useDeviceStore((s) => s.speakerId);
  const outputSupported = useDeviceStore((s) => s.outputSupported);
  const outputVolume = useDeviceStore((s) => s.outputVolume);
  const setOutputVolume = useDeviceStore((s) => s.setOutputVolume);
  const inputVolume = useDeviceStore((s) => s.inputVolume);
  const setInputVolume = useDeviceStore((s) => s.setInputVolume);

  // The section mounts on open — re-enumerate so the dropdowns reflect this instant.
  useEffect(() => {
    void deviceManager.refresh();
  }, []);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <DeviceSelect
            label="Input device"
            devices={inputs}
            fallbackName="Microphone"
            selectedId={micId}
            onSelect={(deviceId) => void deviceManager.setMicPreference(deviceId)}
          />
          <VolumeSlider label="Input volume" volume={inputVolume} onChange={setInputVolume} />
          <NoiseSuppressionSelect />
          <MicProcessingToggles />
        </div>

        <div className="flex flex-col gap-4">
          {outputSupported && (
            <DeviceSelect
              label="Output device"
              devices={outputs}
              fallbackName="Speaker"
              selectedId={speakerId}
              onSelect={(deviceId) => deviceManager.setSpeakerPreference(deviceId)}
            />
          )}
          <VolumeSlider label="Output volume" volume={outputVolume} onChange={setOutputVolume} />
        </div>
      </div>

      <VoiceSounds />
    </div>
  );
}

/** Label + percent readout + 0–100 slider over a 0..1 store volume. */
function VolumeSlider({
  label,
  volume,
  onChange,
}: {
  label: string;
  volume: number;
  onChange: (volume: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground">{Math.round(volume * 100)}%</span>
      </div>
      <Slider
        aria-label={label}
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onValueChange={(value) => onChange((Array.isArray(value) ? (value[0] ?? 0) : value) / 100)}
      />
    </div>
  );
}

/** The browser's default/communications pseudo-entries — replaced by our own default row. */
const PSEUDO_DEVICE_IDS = new Set(["default", "communications"]);

/** "" stands in for the null (system default) preference — Select values are strings. */
const SYSTEM_DEFAULT = "";

function DeviceSelect({
  label,
  devices,
  fallbackName,
  selectedId,
  onSelect,
}: {
  label: string;
  devices: DeviceInfo[];
  /** Label stem for devices the browser won't name (no permission yet). */
  fallbackName: string;
  /** The persisted preference; null = system default. */
  selectedId: string | null;
  onSelect: (deviceId: string | null) => void;
}) {
  const concrete = devices.filter((device) => !PSEUDO_DEVICE_IDS.has(device.deviceId));
  const items = [
    { value: SYSTEM_DEFAULT, label: "System default" },
    ...concrete.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `${fallbackName} ${index + 1}`,
    })),
  ];
  // An unplugged preference isn't in the list — show what's actually active (the
  // fallback); the preference itself stays put and a replug switches back (#25).
  const value =
    selectedId !== null && items.some((item) => item.value === selectedId)
      ? selectedId
      : SYSTEM_DEFAULT;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onSelect(next === SYSTEM_DEFAULT ? null : (next as string))}
      >
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

const NS_OPTIONS: Array<{ value: NoiseSuppressionMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "standard", label: "Standard" },
  { value: "dtln", label: "DTLN" },
];

/**
 * The three-way noise-suppression mode (#122): None, the browser's built-in (Standard),
 * or the DTLN worklet — one suppressor at a time by construction. A change mid-call
 * rebuilds the mic chain seamlessly (producer track swap, no re-join). DTLN needs an
 * AudioWorklet in a secure context; where that's missing the option is disabled with a
 * hint and a stored dtln preference behaves as Standard.
 */
function NoiseSuppressionSelect() {
  const mode = useDeviceStore((s) => s.noiseSuppression);
  const dtlnAvailable = supportsDtln();

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Noise suppression</Label>
      <Select
        items={NS_OPTIONS}
        value={mode}
        onValueChange={(next) =>
          void deviceManager.setNoiseSuppression(next as NoiseSuppressionMode)
        }
      >
        <SelectTrigger aria-label="Noise suppression" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {NS_OPTIONS.map((option) => {
              const unavailable = option.value === "dtln" && !dtlnAvailable;
              return (
                <SelectItem key={option.value} value={option.value} disabled={unavailable}>
                  {option.label}
                  {unavailable && (
                    <span className="text-muted-foreground">requires AudioWorklet support</span>
                  )}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

const PROCESSING_ROWS: Array<{ setting: MicProcessingSetting; label: string }> = [
  { setting: "agc", label: "Automatic gain control" },
  { setting: "echoCancellation", label: "Echo cancellation" },
];

/**
 * The browser's built-in mic processing stages (#81), all defaulting on. A flip
 * re-captures through the chain mid-call; with no live session it applies on next join.
 */
function MicProcessingToggles() {
  const agc = useDeviceStore((s) => s.agc);
  const echoCancellation = useDeviceStore((s) => s.echoCancellation);
  const enabled = { agc, echoCancellation };

  return (
    <div className="flex flex-col">
      {PROCESSING_ROWS.map((row) => (
        <div key={row.setting} className="flex items-center gap-2 border-b border-border/50 py-1.5">
          <span className="flex-1 text-sm">{row.label}</span>
          <Switch
            aria-label={row.label}
            checked={enabled[row.setting]}
            onCheckedChange={(checked) => void deviceManager.setMicProcessing(row.setting, checked)}
          />
        </div>
      ))}
    </div>
  );
}

const VOICE_SOUND_ROWS: Array<{ cue: SoundCue; label: string }> = [
  { cue: "self-join", label: "Join voice" },
  { cue: "self-leave", label: "Leave voice" },
  { cue: "mute-on", label: "Mute" },
  { cue: "mute-off", label: "Unmute" },
  { cue: "deafen-on", label: "Deafen" },
  { cue: "deafen-off", label: "Undeafen" },
  { cue: "peer-join", label: "Someone joins" },
  { cue: "peer-leave", label: "Someone leaves" },
];

/** Per-cue toggles over `konusLa.sound-prefs` (#77) with a preview beside each row. */
function VoiceSounds() {
  const prefs = useSoundPrefs((s) => s.prefs);
  const setCueEnabled = useSoundPrefs((s) => s.setCueEnabled);

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Voice sounds
      </div>
      <div className="flex flex-col">
        {VOICE_SOUND_ROWS.map((row) => (
          <div key={row.cue} className="flex items-center gap-2 border-b border-border/50 py-1.5">
            <span className="flex-1 text-sm">{row.label}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Preview ${row.label} sound`}
              title="Preview"
              className="text-muted-foreground"
              onClick={() => previewSoundCue(row.cue)}
            >
              <PlayIcon className="size-3.5" />
            </Button>
            <Switch
              aria-label={`${row.label} sound`}
              checked={isSoundCueEnabled(prefs, row.cue)}
              onCheckedChange={(checked) => setCueEnabled(row.cue, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
