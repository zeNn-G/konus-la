import { useEffect, useState } from "react";

import { useTypingEntries } from "@/lib/use-realtime";

/**
 * "alice is typing…" strip under the message list. Entries come from ephemeral realtime
 * events; a 1s tick drops the expired ones (there is no typing.stop — expiry IS the stop,
 * and the dispatcher clears an author's entry the moment their message lands).
 */
export function TypingLine({ channelId }: { channelId: string }) {
  const entries = useTypingEntries(channelId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (entries.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries.length]);

  const active = entries.filter((entry) => entry.expiresAt > now);
  const names = active.map((entry) => entry.displayName);

  let text = " "; // keep the line's height stable
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = "Several people are typing…";

  return <p className="px-4 pb-1 text-xs text-muted-foreground italic">{text}</p>;
}
