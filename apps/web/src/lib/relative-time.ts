const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 hours ago" — the settings views' shared timestamp voice; sub-minute is "just now". */
export function relativeTime(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  for (const [unit, span] of TIME_UNITS) {
    if (Math.abs(seconds) >= span) return relativeFormat.format(Math.round(seconds / span), unit);
  }
  return "just now";
}
