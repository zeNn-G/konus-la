import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { requireChannelMember } from "../index";
import { perUserRatelimit, voiceFlagsLimiter, voiceJoinLimiter } from "../ratelimit";
import { voiceProcedure } from "../voice/availability";
import { joinVoice, leaveVoice, setSelfDeaf, setSelfMute } from "../voice/rooms";

/**
 * Voice occupancy signaling (phase-5 spec §Procedures; slice 2 of 5): the seat lifecycle
 * and self flags. Media signaling (transports / produce / consume) lands in the next
 * slice. Everything here rides `voiceProcedure`: availability-gated, WS-only.
 */
export const voiceRouter = {
  /**
   * The universal entry — fresh join, channel switch, grace rebind, multi-tab steal, and
   * post-restart recovery are all this call; the server sorts out the flavor. Returns the
   * seat-session id minted for THIS bind (`sessionReplaced` names the one that lost).
   */
  join: voiceProcedure
    .input(z.object({ channelId: z.string() }))
    .use(requireChannelMember)
    .use(perUserRatelimit("voiceJoin", voiceJoinLimiter))
    .handler(async ({ context }) => {
      const { channel } = context;
      if (channel.kind !== "voice" || !channel.guildId) {
        throw new ORPCError("NOT_FOUND", { message: "Not a voice channel." });
      }
      return joinVoice({
        userId: context.user.id,
        connectionId: context.connectionId,
        guildId: channel.guildId,
        channelId: channel.id,
      });
    }),

  /** Explicit leave: immediate peerLeft, no grace. Shares the join budget (#16). */
  leave: voiceProcedure
    .use(perUserRatelimit("voiceJoin", voiceJoinLimiter))
    .handler(async ({ context }) => {
      await leaveVoice(context.user.id);
    }),

  setSelfMute: voiceProcedure
    .input(z.object({ muted: z.boolean() }))
    .use(perUserRatelimit("voiceFlags", voiceFlagsLimiter))
    .handler(async ({ input, context, errors }) => {
      if (!(await setSelfMute(context.user.id, input.muted))) {
        throw errors.VOICE_INVALID_STATE();
      }
    }),

  /**
   * Flag-only in this slice; the server half of deafen (pausing the peer's audio
   * consumers) arrives with the media slice.
   */
  setSelfDeaf: voiceProcedure
    .input(z.object({ deafened: z.boolean() }))
    .use(perUserRatelimit("voiceFlags", voiceFlagsLimiter))
    .handler(async ({ input, context, errors }) => {
      if (!(await setSelfDeaf(context.user.id, input.deafened))) {
        throw errors.VOICE_INVALID_STATE();
      }
    }),
};
