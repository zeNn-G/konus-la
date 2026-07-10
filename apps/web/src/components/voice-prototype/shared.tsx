// VOICE UX PROTOTYPE (wayfinder #10) — THROWAWAY. Variant plumbing shared by all three
// variants: `?voice=a|b|c` search param, floating switcher bar, fake media surfaces,
// device-picker list. Delete this folder after the variant decision.
import { cn } from "@konus-la/ui/lib/utils";
import { getRouteApi, useNavigate, useSearch } from "@tanstack/react-router";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect } from "react";

import {
  PROTO_INPUT_DEVICES,
  PROTO_OUTPUT_DEVICES,
  useVoiceProto,
  voiceProto,
} from "./store";

export type VoiceVariant = "a" | "b" | "c";
const ORDER: VoiceVariant[] = ["a", "b", "c"];
const LABELS: Record<VoiceVariant, string> = {
  a: "A — Room takeover",
  b: "B — Voice rides along",
  c: "C — Split stage",
};

/** Active prototype variant, or null when the prototype is off. Dev builds only. */
export function useVoiceProtoVariant(): VoiceVariant | null {
  const search = useSearch({ strict: false }) as { voice?: string };
  if (!import.meta.env.DEV) return null;
  return search.voice === "a" || search.voice === "b" || search.voice === "c"
    ? search.voice
    : null;
}

const appRoute = getRouteApi("/(app)");

/** The signed-in user as a fake peer ("you" in every variant). */
export function useSelfPeer() {
  const { session } = appRoute.useRouteContext();
  const username = session.user.username ?? session.user.email;
  return { id: "self", seed: username, name: session.user.name || username };
}

/** Floating bottom-center variant switcher — obviously not part of the design under review. */
export function VoiceProtoSwitcher() {
  const variant = useVoiceProtoVariant();
  const navigate = useNavigate();

  const cycle = (dir: 1 | -1) => {
    if (!variant) return;
    const next = ORDER[(ORDER.indexOf(variant) + dir + ORDER.length) % ORDER.length]!;
    void navigate({
      to: ".",
      replace: true,
      search: (prev: Record<string, unknown>) => ({ ...prev, voice: next }),
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!variant) return null;
  return (
    <div className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 bg-foreground px-1 py-1 text-background shadow-lg">
      <button
        type="button"
        aria-label="Previous variant"
        className="p-1 hover:bg-background/20"
        onClick={() => cycle(-1)}
      >
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="min-w-44 px-1 text-center font-mono text-xs">{LABELS[variant]}</span>
      <button
        type="button"
        aria-label="Next variant"
        className="p-1 hover:bg-background/20"
        onClick={() => cycle(1)}
      >
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  );
}

/** Fake screenshare content — a mock code editor so tiles read as "someone's screen". */
export function FakeScreen({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5 overflow-hidden bg-zinc-950 p-3", className)}>
      {[
        ["w-2/5", "bg-violet-400/70"],
        ["w-3/5", "bg-zinc-600"],
        ["w-1/2", "bg-emerald-400/60"],
        ["w-4/5", "bg-zinc-700"],
        ["w-1/3", "bg-sky-400/60"],
        ["w-2/3", "bg-zinc-600"],
        ["w-1/4", "bg-amber-400/60"],
        ["w-3/4", "bg-zinc-700"],
      ].map(([w, c], i) => (
        <div key={i} className={cn("h-1.5 shrink-0", w, c)} />
      ))}
    </div>
  );
}

/** Fake webcam feed — gradient stand-in for video. */
export function FakeCam({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-gradient-to-br from-indigo-500/50 via-fuchsia-500/30 to-emerald-400/40",
        className,
      )}
    />
  );
}

/** Input + output device lists off the fake store; each variant decides where this lives. */
export function DevicePickerContent() {
  const { inputDevice, outputDevice } = useVoiceProto();
  const group = (
    label: string,
    devices: string[],
    selected: string,
    onSelect: (d: string) => void,
  ) => (
    <div className="flex flex-col">
      <span className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      {devices.map((d) => (
        <button
          key={d}
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted"
          onClick={() => onSelect(d)}
        >
          <CheckIcon className={cn("size-3 shrink-0", d === selected ? "" : "invisible")} />
          <span className="truncate">{d}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex w-64 flex-col pb-1">
      {group("Input device", PROTO_INPUT_DEVICES, inputDevice, voiceProto.setInput)}
      {group("Output device", PROTO_OUTPUT_DEVICES, outputDevice, voiceProto.setOutput)}
    </div>
  );
}

/** Per-peer volume slider (0–200%). */
export function VolumeSlider({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <input
      type="range"
      min={0}
      max={200}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("h-1 w-full cursor-pointer accent-green-500", className)}
    />
  );
}
