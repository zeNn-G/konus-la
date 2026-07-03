import { protectedProcedure } from "../index";
import type { RealtimeEvent } from "../realtime/events";
import { presenceSnapshotFor } from "../realtime/presence";
import { publisher } from "../realtime/publisher";

export const realtimeRouter = {
  /**
   * The single live stream per connection (called over the WS transport). `requireAuth`
   * runs on this call, which IS the session re-check at subscription start. Subscribe
   * happens before the snapshot read so no presence transition can fall in between;
   * the snapshot yield carries no event meta, so it never disturbs `lastEventId` resume.
   */
  events: protectedProcedure.handler(async function* ({ context, signal, lastEventId }) {
    const iterator = publisher.subscribe(`user:${context.user.id}`, { signal, lastEventId });
    const snapshot: RealtimeEvent = {
      type: "presence.snapshot",
      onlineUserIds: await presenceSnapshotFor(context.user.id),
    };
    yield snapshot;
    yield* iterator;
  }),
};
