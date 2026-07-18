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

import { previewSoundCue, useSoundPrefs, type SoundCue } from "@/lib/sound-effects";
import { useDeviceStore, type DeviceInfo } from "@/lib/voice/devices";
import { deviceManager } from "@/lib/voice/session";

/**
 * The dialog's Voice section (#85, Discord Voice-Settings layout): input/output device
 * dropdowns side by side, the master output volume (#78) under the output column, and
 * the voice-sound toggles below. The input
 * column receives its volume slider and processing toggles in 7.4. Where output
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

  // The section mounts on open — re-enumerate so the dropdowns reflect this instant.
  useEffect(() => {
    void deviceManager.refresh();
  }, []);

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 sm:grid-cols-2">
        {/* Input column — 7.4 adds the input volume slider and processing toggles here. */}
        <div className="flex flex-col gap-4">
          <DeviceSelect
            label="Input device"
            devices={inputs}
            fallbackName="Microphone"
            selectedId={micId}
            onSelect={(deviceId) => void deviceManager.setMicPreference(deviceId)}
          />
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
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label>Output volume</Label>
              <span className="text-xs text-muted-foreground">
                {Math.round(outputVolume * 100)}%
              </span>
            </div>
            <Slider
              aria-label="Output volume"
              min={0}
              max={100}
              value={Math.round(outputVolume * 100)}
              onValueChange={(value) =>
                setOutputVolume((Array.isArray(value) ? (value[0] ?? 0) : value) / 100)
              }
            />
          </div>
        </div>
      </div>

      <VoiceSounds />
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
              checked={prefs[row.cue] !== false}
              onCheckedChange={(checked) => setCueEnabled(row.cue, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
