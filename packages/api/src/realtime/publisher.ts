import { MemoryPublisher } from "@orpc/experimental-publisher/memory";

import type { EventMap } from "./events";

export const publisher = new MemoryPublisher<EventMap>();
