import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import { createRatelimitMiddleware } from "@orpc/experimental-ratelimit";
import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import type { Middleware } from "@orpc/server";

import type { AuthedContext } from "./index";

/**
 * Per-user sliding-window limits (in-memory — single process, matching the MemoryPublisher).
 * One limiter instance per rule; keys are `rule:userId`. Exceeding throws TOO_MANY_REQUESTS.
 *
 * Dev note: `bun --hot` resets the windows.
 */

export const sendMessageLimiter = new MemoryRatelimiter({ maxRequests: 30, window: 10_000 });
export const markReadLimiter = new MemoryRatelimiter({ maxRequests: 60, window: 60_000 });
export const typingLimiter = new MemoryRatelimiter({ maxRequests: 1, window: 1_000 });
export const inviteCreateLimiter = new MemoryRatelimiter({ maxRequests: 5, window: 3_600_000 });
export const dmOpenLimiter = new MemoryRatelimiter({ maxRequests: 30, window: 60_000 });
export const dmCreateGroupLimiter = new MemoryRatelimiter({ maxRequests: 10, window: 3_600_000 });
/** Shared instance for add/remove/leave/rename — distinct rules keep distinct windows. */
export const dmMutateLimiter = new MemoryRatelimiter({ maxRequests: 30, window: 60_000 });
export const userSearchLimiter = new MemoryRatelimiter({ maxRequests: 20, window: 10_000 });
/** Shared by `voice.join` AND `voice.leave` — one budget for the join/leave pair (#16). */
export const voiceJoinLimiter = new MemoryRatelimiter({ maxRequests: 10, window: 60_000 });
/** Shared by `voice.setSelfMute` / `voice.setSelfDeaf`. */
export const voiceFlagsLimiter = new MemoryRatelimiter({ maxRequests: 10, window: 10_000 });
/** One budget for the whole media ceremony: transports, connect, produce, closeProducer. */
export const voiceSignalLimiter = new MemoryRatelimiter({ maxRequests: 15, window: 10_000 });
/** Shared by `voice.consume` / `voice.setConsumersPaused` — visibility churn is chatty. */
export const voiceConsumeLimiter = new MemoryRatelimiter({ maxRequests: 60, window: 10_000 });
/**
 * One budget for EVERY role + moderation mutation (rule "modAction") — a backstop against
 * scripted abuse, roomy for real moderation (ADR 0008 spec).
 */
export const modActionLimiter = new MemoryRatelimiter({ maxRequests: 30, window: 60_000 });

/** Rate-limit an authenticated procedure by caller id. Chain after `protectedProcedure`. */
export function perUserRatelimit(
  rule: string,
  limiter: Ratelimiter,
  // `any` slots mirror the lib's own Middleware signature for output/errors.
): Middleware<AuthedContext, Record<never, never>, unknown, any, any, Record<never, never>> {
  return createRatelimitMiddleware<AuthedContext>({
    limiter: () => limiter,
    key: ({ context }) => `${rule}:${context.user.id}`,
  });
}
