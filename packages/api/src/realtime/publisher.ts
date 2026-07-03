import { MemoryPublisher } from "@orpc/experimental-publisher/memory";

import type { EventMap } from "./events";

// Short resume window: a reconnecting client replays the gap via `lastEventId` instead of
// refetching everything. Gaps older than this are silent — the client compensates by
// invalidating all queries on reconnect (see apps/web useRealtime).
export const publisher = new MemoryPublisher<EventMap>({ resumeRetentionSeconds: 120 });
