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
 * Base builder for every `voice.*` procedure (procedures land in later slices; the gate
 * lives here). While voice is declared down each call fails fast with the defined
 * `VOICE_UNAVAILABLE` error — the client shows "voice unavailable, retrying" instead of
 * entering its rejoin loop.
 */
export const voiceProcedure = protectedProcedure
  .errors({
    VOICE_UNAVAILABLE: {
      status: 503,
      message: "Voice is temporarily unavailable",
    },
  })
  .use(({ errors, next }) => {
    if (voiceDown) {
      throw errors.VOICE_UNAVAILABLE();
    }
    return next();
  });
