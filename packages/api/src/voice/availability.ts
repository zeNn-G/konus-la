import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";

/**
 * Voice down-state (phase-5 spec §Worker lifecycle): flipped by the server's SFU
 * crash-loop breaker — declared down after 3 worker deaths in 60 s, back up when a
 * respawn sticks. In-memory like the rooms it guards; a restart resets it to "up"
 * alongside the worker that boot creates.
 */
let voiceDown = false;

export function setVoiceDown(down: boolean): void {
  voiceDown = down;
}

export function isVoiceDown(): boolean {
  return voiceDown;
}

/**
 * Base builder for every `voice.*` procedure. Two gates ride on it:
 *
 * - While voice is declared down each call fails fast with the defined `VOICE_UNAVAILABLE`
 *   error — the client shows "voice unavailable, retrying" instead of entering its rejoin
 *   loop.
 * - Voice signaling is WS-only, enforced rather than conventional (ADR 0007): a call whose
 *   context lacks the `connectionId` the `/ws` message handler injects — i.e. anything
 *   arriving via fetch `/rpc` — is rejected, and handlers downstream see a non-optional
 *   `context.connectionId`.
 *
 * `VOICE_INVALID_STATE` is declared here for every builder off this base: an out-of-order
 * signaling call (flags before a seat today; the peer state machine in the media slice).
 */
export const voiceProcedure = protectedProcedure
  .errors({
    VOICE_UNAVAILABLE: {
      status: 503,
      message: "Voice is temporarily unavailable",
    },
    VOICE_INVALID_STATE: {
      status: 409,
      message: "Voice call out of order for the current session state",
    },
  })
  .use(({ errors, next }) => {
    if (voiceDown) {
      throw errors.VOICE_UNAVAILABLE();
    }
    return next();
  })
  .use(({ context, next }) => {
    const { connectionId } = context;
    if (!connectionId) {
      throw new ORPCError("FORBIDDEN", {
        message: "Voice signaling requires the realtime WebSocket connection.",
      });
    }
    return next({ context: { connectionId } });
  });
