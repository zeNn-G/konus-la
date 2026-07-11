import { protectedProcedure } from "../index";
import type { RealtimeEvent } from "../realtime/events";
import { presenceSnapshotFor } from "../realtime/presence";
import { publisher } from "../realtime/publisher";
import { voiceSnapshotFor } from "../voice/rooms";

export const realtimeRouter = {
  /**
   * The single live stream per connection (called over the WS transport). `requireAuth`
   * runs on this call, which IS the session re-check at subscription start. Subscribe
   * happens before the snapshot reads so no presence or occupancy transition can fall in
   * between; the snapshot yields carry no event meta, so they never disturb `lastEventId`
   * resume. Voice occupancy has no fetch path — this snapshot + the `voice.*` events ARE
   * the occupancy protocol, so reconnects re-sync by resubscription alone (ADR 0007).
   */
  events: protectedProcedure.handler(async function* ({ context, signal, lastEventId }) {
    const iterator = publisher.subscribe(`user:${context.user.id}`, { signal, lastEventId });
    const presenceSnapshot: RealtimeEvent = {
      type: "presence.snapshot",
      onlineUserIds: await presenceSnapshotFor(context.user.id),
    };
    yield presenceSnapshot;
    const voiceSnapshot: RealtimeEvent = {
      type: "voice.snapshot",
      rooms: await voiceSnapshotFor(context.user.id),
    };
    yield voiceSnapshot;
    yield* iterator;
  }),
};
