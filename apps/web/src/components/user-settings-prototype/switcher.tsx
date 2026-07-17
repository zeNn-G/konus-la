// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Floating variant switcher; dev-only
// and only rendered while ?variant= is present, so the normal app never shows it.

import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { SETTINGS_VARIANTS, useSetSettingsVariant, useSettingsVariant } from "./use-variant";

export function UserSettingsPrototypeSwitcher() {
  const variant = useSettingsVariant();
  const setVariant = useSetSettingsVariant();

  const index = SETTINGS_VARIANTS.findIndex((v) => v.key === variant);
  const cycle = (delta: number) => {
    const next =
      SETTINGS_VARIANTS[(index + delta + SETTINGS_VARIANTS.length) % SETTINGS_VARIANTS.length];
    setVariant(next.key);
  };

  useEffect(() => {
    if (variant === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!import.meta.env.DEV || variant === null) return null;
  const current = SETTINGS_VARIANTS[index];

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border border-amber-400/60 bg-zinc-900 px-2 py-1.5 text-zinc-50 shadow-lg">
      <button
        type="button"
        aria-label="Previous variant"
        className="rounded-full p-1 hover:bg-zinc-700"
        onClick={() => cycle(-1)}
      >
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="min-w-44 text-center text-xs font-medium tracking-wide">
        {current.key.toUpperCase()} — {current.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        className="rounded-full p-1 hover:bg-zinc-700"
        onClick={() => cycle(1)}
      >
        <ChevronRightIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Exit prototype"
        className="ml-1 rounded-full p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-50"
        onClick={() => setVariant(null)}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
