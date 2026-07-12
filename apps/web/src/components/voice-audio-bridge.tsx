import { useEffect, useRef } from "react";

import { useVoiceStore } from "@/lib/voice/store";

/**
 * The ONLY place remote voice audio is rendered (phase-5 spec §Client architecture).
 * Mounted once in the authenticated shell, so playback survives every pane ↔ mini-stage
 * transition — video elements live in the visual components, audio never does. One
 * element per remote peer with a live mic consumer, volume from the persisted per-peer
 * setting. Audio consumers are resumed server-side the moment they're created
 * (VoiceSession), and are never visibility-paused.
 */
export function VoiceAudioBridge() {
  const peers = useVoiceStore((state) => state.peers);
  const volumes = useVoiceStore((state) => state.volumes);

  return (
    <>
      {Object.entries(peers).map(([userId, media]) =>
        media.mic ? (
          <AudioSink key={userId} track={media.mic.track} volume={volumes[userId] ?? 1} />
        ) : null,
      )}
    </>
  );
}

function AudioSink({ track, volume }: { track: MediaStreamTrack; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    // Joining voice required a click, so the autoplay gesture requirement is satisfied.
    void element.play().catch(() => {});
  }, [track]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  return <audio ref={ref} autoPlay />;
}
