import { useEffect, useRef } from "react";

import { useVoiceStore } from "@/lib/voice/store";
import type { TileFace } from "@/lib/voice/ui-model";

type VideoFace = Extract<TileFace, { kind: "screen" | "cam" }>;

/**
 * One rendered video track. Remote faces carry a consumerId and register video interest
 * for their lifetime — VoiceSession turns that into server-side consumer resume/pause
 * (issue #18) — while local faces (consumerId null) just play the track.
 */
export function VideoSurface({ face, className }: { face: VideoFace; className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const bindVideo = useVoiceStore((s) => s.bindVideo);
  const unbindVideo = useVoiceStore((s) => s.unbindVideo);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([face.track]);
  }, [face.track]);

  const consumerId = face.consumerId;
  useEffect(() => {
    if (!consumerId) return;
    bindVideo(consumerId);
    return () => unbindVideo(consumerId);
  }, [consumerId, bindVideo, unbindVideo]);

  return <video ref={ref} autoPlay muted playsInline className={className} />;
}
