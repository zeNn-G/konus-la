// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Field-level building blocks the three
// variants compose differently. Layout/IA stays in the variant files — that's the
// question under test; these are just the knobs.

import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Input } from "@konus-la/ui/components/input";
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
import { cn } from "@konus-la/ui/lib/utils";
import { CheckIcon, PlayIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  FAKE_INPUTS,
  FAKE_OUTPUTS,
  SOUND_LABELS,
  playBlip,
  usePrototypeStore,
  type SoundKey,
} from "./store";

/* ---------- primitives ---------------------------------------------------------- */

/** Discord-style pill toggle (the ui package has no switch; checkbox reads wrong here). */
export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        on ? "bg-green-500" : "bg-muted-foreground/40",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
          on ? "left-4.5" : "left-0.5",
        )}
      />
    </button>
  );
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {children}
    </div>
  );
}

function RadioRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60",
            value === option.value && "bg-muted",
          )}
        >
          <CheckIcon
            className={cn("size-3.5 shrink-0", value !== option.value && "invisible")}
          />
          <span>{option.label}</span>
          {option.hint && (
            <span className="ml-auto text-xs text-muted-foreground">{option.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- profile -------------------------------------------------------------- */

export function ProfileFields({
  name,
  username,
  image,
}: {
  name: string;
  username: string;
  image?: string | null;
}) {
  const displayName = usePrototypeStore((s) => s.displayName) || name;
  const setDisplayName = usePrototypeStore((s) => s.setDisplayName);

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar seed={username} src={image} className="size-12" />
        <div>
          <div className="font-medium">{displayName}</div>
          <div className="text-muted-foreground">@{username}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proto-display-name">Display name</Label>
        <Input
          id="proto-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proto-username">Username</Label>
        <Input id="proto-username" value={username} disabled />
        <p className="text-xs text-muted-foreground">Usernames are permanent.</p>
      </div>
      <div>
        <Button onClick={() => toast.success("Prototype — nothing was saved.")}>Save</Button>
      </div>
    </div>
  );
}

/* ---------- voice ----------------------------------------------------------------- */

function DeviceList({
  title,
  fakes,
  selected,
  onSelect,
}: {
  title: string;
  fakes: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <FieldGroup title={title}>
      <RadioRow
        options={[
          { value: "__default", label: "System default" },
          ...fakes.map((label) => ({ value: label, label })),
        ]}
        value={selected ?? "__default"}
        onChange={(v) => onSelect(v === "__default" ? null : v)}
      />
    </FieldGroup>
  );
}

/** Input/output pickers — the DevicePicker's lists, re-homed (fake devices). */
export function DeviceFields({ sideBySide = false }: { sideBySide?: boolean }) {
  const micChoice = usePrototypeStore((s) => s.micChoice);
  const speakerChoice = usePrototypeStore((s) => s.speakerChoice);
  const setMicChoice = usePrototypeStore((s) => s.setMicChoice);
  const setSpeakerChoice = usePrototypeStore((s) => s.setSpeakerChoice);

  return (
    <div className={sideBySide ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "flex flex-col gap-4"}>
      <DeviceList
        title="Input device"
        fakes={FAKE_INPUTS}
        selected={micChoice}
        onSelect={setMicChoice}
      />
      <DeviceList
        title="Output device"
        fakes={FAKE_OUTPUTS}
        selected={speakerChoice}
        onSelect={setSpeakerChoice}
      />
    </div>
  );
}

/** Discord-style Voice Settings grid: device dropdowns side by side, a volume slider
 * under each. Output volume doubles as the master output volume. */
export function DeviceVolumeGrid() {
  const micChoice = usePrototypeStore((s) => s.micChoice);
  const speakerChoice = usePrototypeStore((s) => s.speakerChoice);
  const setMicChoice = usePrototypeStore((s) => s.setMicChoice);
  const setSpeakerChoice = usePrototypeStore((s) => s.setSpeakerChoice);
  const micVolume = usePrototypeStore((s) => s.micVolume);
  const setMicVolume = usePrototypeStore((s) => s.setMicVolume);
  const masterVolume = usePrototypeStore((s) => s.masterVolume);
  const setMasterVolume = usePrototypeStore((s) => s.setMasterVolume);

  const column = (
    deviceTitle: string,
    fakes: string[],
    selected: string | null,
    onSelect: (id: string | null) => void,
    volumeTitle: string,
    volume: number,
    onVolume: (v: number) => void,
  ) => {
    const items = [
      { value: "__default", label: "System default" },
      ...fakes.map((label) => ({ value: label, label })),
    ];
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <FieldGroup title={deviceTitle}>
          <Select
            items={items}
            value={selected ?? "__default"}
            onValueChange={(value) => onSelect(value === "__default" ? null : (value as string))}
          >
            <SelectTrigger className="w-full">
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
        </FieldGroup>
        <FieldGroup title={volumeTitle}>
          <div className="flex items-center gap-3 py-1">
            <Slider
              value={[volume]}
              onValueChange={(v) => onVolume(Array.isArray(v) ? (v[0] ?? 0) : v)}
            />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {volume}%
            </span>
          </div>
        </FieldGroup>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {column("Input device", FAKE_INPUTS, micChoice, setMicChoice, "Input volume", micVolume, setMicVolume)}
      {column("Output device", FAKE_OUTPUTS, speakerChoice, setSpeakerChoice, "Output volume", masterVolume, setMasterVolume)}
    </div>
  );
}

export function MasterVolumeField() {
  const masterVolume = usePrototypeStore((s) => s.masterVolume);
  const setMasterVolume = usePrototypeStore((s) => s.setMasterVolume);
  return (
    <FieldGroup title="Master output volume">
      <div className="flex items-center gap-3 py-1">
        <Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
        <Slider
          value={[masterVolume]}
          onValueChange={(v) => setMasterVolume(Array.isArray(v) ? (v[0] ?? 0) : v)}
        />
        <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
          {masterVolume}%
        </span>
      </div>
    </FieldGroup>
  );
}

/** The sound-effect toggles; `only` filters the list so variants can split the inventory. */
export function SoundFields({ only, title }: { only?: SoundKey[]; title: string }) {
  const soundsEnabled = usePrototypeStore((s) => s.soundsEnabled);
  const setSoundsEnabled = usePrototypeStore((s) => s.setSoundsEnabled);
  const soundVolume = usePrototypeStore((s) => s.soundVolume);
  const setSoundVolume = usePrototypeStore((s) => s.setSoundVolume);
  const sounds = usePrototypeStore((s) => s.sounds);
  const toggleSound = usePrototypeStore((s) => s.toggleSound);

  const rows = SOUND_LABELS.filter((s) => !only || only.includes(s.key));

  return (
    <FieldGroup title={title}>
      <SettingRow label="Enable sound effects">
        <Toggle on={soundsEnabled} onToggle={() => setSoundsEnabled(!soundsEnabled)} />
      </SettingRow>
      <div className="flex items-center gap-3 py-1">
        <span className="text-xs text-muted-foreground">Volume</span>
        <Slider
          value={[soundVolume]}
          disabled={!soundsEnabled}
          onValueChange={(v) => setSoundVolume(Array.isArray(v) ? (v[0] ?? 0) : v)}
        />
        <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
          {soundVolume}%
        </span>
      </div>
      <div className={cn("flex flex-col", !soundsEnabled && "pointer-events-none opacity-50")}>
        {rows.map((row, i) => (
          <div key={row.key} className="flex items-center gap-2 py-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Preview ${row.label}`}
              onClick={() => playBlip(520 + i * 90)}
            >
              <PlayIcon className="size-3" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
            <Toggle on={sounds[row.key]} onToggle={() => toggleSound(row.key)} />
          </div>
        ))}
      </div>
    </FieldGroup>
  );
}

/* ---------- notifications --------------------------------------------------------- */

export function NotificationPermissionField() {
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    supported ? Notification.permission : "unsupported",
  );

  const badge =
    permission === "granted"
      ? { text: "Enabled", cls: "bg-green-500/15 text-green-500" }
      : permission === "denied"
        ? { text: "Blocked in browser", cls: "bg-red-500/15 text-red-500" }
        : permission === "unsupported"
          ? { text: "Not supported", cls: "bg-muted text-muted-foreground" }
          : { text: "Not enabled", cls: "bg-amber-500/15 text-amber-500" };

  return (
    <FieldGroup title="Desktop notifications">
      <SettingRow
        label="Browser permission"
        hint={
          permission === "denied"
            ? "Unblock notifications in your browser's site settings."
            : undefined
        }
      >
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", badge.cls)}>
          {badge.text}
        </span>
      </SettingRow>
      {permission === "default" && (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void Notification.requestPermission().then(setPermission)}
          >
            Enable desktop notifications
          </Button>
        </div>
      )}
    </FieldGroup>
  );
}

export function NotificationDefaultFields() {
  const dmDefault = usePrototypeStore((s) => s.dmDefault);
  const setDmDefault = usePrototypeStore((s) => s.setDmDefault);
  const guildDefault = usePrototypeStore((s) => s.guildDefault);
  const setGuildDefault = usePrototypeStore((s) => s.setGuildDefault);

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup title="Direct messages">
        <RadioRow
          options={[
            { value: "all", label: "All messages", hint: "default" },
            { value: "muted", label: "Muted" },
          ]}
          value={dmDefault}
          onChange={setDmDefault}
        />
      </FieldGroup>
      <FieldGroup title="Guild messages">
        <RadioRow
          options={[
            { value: "all", label: "All messages" },
            { value: "mentions", label: "Only @mentions", hint: "default" },
            { value: "muted", label: "Muted" },
          ]}
          value={guildDefault}
          onChange={setGuildDefault}
        />
        <p className="px-2 text-xs text-muted-foreground">
          Per-channel overrides live on each channel's context menu.
        </p>
      </FieldGroup>
    </div>
  );
}

export function NotificationSoundField() {
  const notificationSounds = usePrototypeStore((s) => s.notificationSounds);
  const setNotificationSounds = usePrototypeStore((s) => s.setNotificationSounds);
  return (
    <FieldGroup title="Sounds">
      <SettingRow label="Play a sound for notifications">
        <div className="flex items-center gap-2">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Preview notification sound"
            onClick={() => playBlip(880)}
          >
            <PlayIcon className="size-3" />
          </Button>
          <Toggle
            on={notificationSounds}
            onToggle={() => setNotificationSounds(!notificationSounds)}
          />
        </div>
      </SettingRow>
    </FieldGroup>
  );
}
