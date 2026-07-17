import { useEffect, useRef } from "react";

import { useDeviceStore } from "@/lib/voice/devices";
import { useVoiceStore } from "@/lib/voice/store";

/**
 * The ONLY place remote voice audio is rendered (phase-5 spec §Client architecture).
 * Mounted once in the authenticated shell, so playback survives every pane ↔ mini-stage
 * transition — video elements live in the visual components, audio never does. Up to two
 * elements per remote peer — mic and screenshare audio — both driven by the ONE persisted
 * per-peer volume (volume 0 mutes the person wholesale). `peers` holds remote media only
 * (own producer events are filtered in the dispatcher), so the sharer never hears their
 * own share back. Audio consumers are resumed server-side the moment they're created
 * (VoiceSession), and are never visibility-paused.
 */
export function VoiceAudioBridge() {
  const peers = useVoiceStore((state) => state.peers);
  const volumes = useVoiceStore((state) => state.volumes);
  // Effective output device (#25): "" = system default; unsupported browsers stay "".
  const sinkId = useDeviceStore((state) => state.sinkId);
  // Master output volume (#78): multiplied into every element here — the per-peer store
  // values stay raw, and voice stays element-volume only (no Web Audio graph, which would
  // regress Firefox output selection).
  const outputVolume = useDeviceStore((state) => state.outputVolume);

  return (
    <>
      {Object.entries(peers).flatMap(([userId, media]) =>
        (["mic", "screenAudio"] as const).map((source) => {
          const remote = media[source];
          return remote ? (
            <AudioSink
              key={`${userId}:${source}`}
              track={remote.track}
              volume={outputVolume * (volumes[userId] ?? 1)}
              sinkId={sinkId}
            />
          ) : null;
        }),
      )}
    </>
  );
}

function AudioSink({
  track,
  volume,
  sinkId,
}: {
  track: MediaStreamTrack;
  volume: number;
  sinkId: string;
}) {
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

  useEffect(() => {
    const element = ref.current;
    if (!element || !("setSinkId" in element)) return;
    // A gone device rejects — the device manager already fell back to "" by then.
    void element.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);

  return <audio ref={ref} autoPlay />;
}
