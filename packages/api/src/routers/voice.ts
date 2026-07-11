import { ORPCError } from "@orpc/server";
import type { types } from "mediasoup";
import { z } from "zod";

import { requireChannelMember } from "../index";
import {
  perUserRatelimit,
  voiceConsumeLimiter,
  voiceFlagsLimiter,
  voiceJoinLimiter,
  voiceSignalLimiter,
} from "../ratelimit";
import { voiceProcedure } from "../voice/availability";
import {
  closeProducer,
  connectTransport,
  consume,
  createTransport,
  getRouterRtpCapabilities,
  produce,
  setConsumersPaused,
} from "../voice/media";
import {
  joinVoice,
  leaveVoice,
  setSelfDeaf,
  setSelfMute,
  VoiceBadMediaError,
  VoiceInvalidStateError,
  VoiceNotFoundError,
  VoiceRoomFullError,
  VoiceUnavailableError,
} from "../voice/rooms";

/**
 * Voice signaling (phase-5 spec §Procedures): seat lifecycle + self flags, and the media
 * ceremony — transports, produce/consume, batched consumer control. Everything here
 * rides `voiceProcedure`: availability-gated, WS-only. The ceremony's ordering invariant
 * (`joined → transportCreated → connected → producing`) is enforced server-side in
 * ../voice/media.ts and surfaces as the defined VOICE_INVALID_STATE error.
 */

/** The defined-error constructors every `voiceProcedure` handler receives. */
type VoiceErrors = {
  VOICE_UNAVAILABLE: (...rest: never[]) => ORPCError<"VOICE_UNAVAILABLE", unknown>;
  VOICE_INVALID_STATE: (...rest: never[]) => ORPCError<"VOICE_INVALID_STATE", unknown>;
};

/** Map the voice domain errors onto the wire vocabulary; anything else stays a 500. */
async function mapVoiceErrors<T>(errors: VoiceErrors, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof VoiceUnavailableError) throw errors.VOICE_UNAVAILABLE();
    if (error instanceof VoiceInvalidStateError) throw errors.VOICE_INVALID_STATE();
    if (error instanceof VoiceNotFoundError) {
      throw new ORPCError("NOT_FOUND", { message: error.message });
    }
    if (error instanceof VoiceBadMediaError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
}

/**
 * Opaque mediasoup wire structures: mediasoup's ORTC layer validates them exhaustively
 * (rejections surface as BAD_REQUEST via VoiceBadMediaError), so zod only pins the outer
 * shape and the TypeScript contract the client sees.
 */
const dtlsParametersSchema = z.custom<types.DtlsParameters>(
  (value) => typeof value === "object" && value !== null,
);
const rtpParametersSchema = z.custom<types.RtpParameters>(
  (value) => typeof value === "object" && value !== null,
);
const rtpCapabilitiesSchema = z.custom<types.RtpCapabilities>(
  (value) => typeof value === "object" && value !== null,
);

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
    .handler(async ({ context, errors }) => {
      const { channel } = context;
      if (channel.kind !== "voice" || !channel.guildId) {
        throw new ORPCError("NOT_FOUND", { message: "Not a voice channel." });
      }
      try {
        return await mapVoiceErrors(errors, () =>
          joinVoice({
            userId: context.user.id,
            connectionId: context.connectionId,
            guildId: channel.guildId as string,
            channelId: channel.id,
          }),
        );
      } catch (error) {
        if (error instanceof VoiceRoomFullError) {
          throw new ORPCError("CONFLICT", { message: "Voice channel is full." });
        }
        throw error;
      }
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
   * The flag broadcast plus deafen's server half: the SFU pauses/resumes the peer's
   * audio consumers (#18) — see rooms.setSelfDeaf.
   */
  setSelfDeaf: voiceProcedure
    .input(z.object({ deafened: z.boolean() }))
    .use(perUserRatelimit("voiceFlags", voiceFlagsLimiter))
    .handler(async ({ input, context, errors }) => {
      if (!(await setSelfDeaf(context.user.id, input.deafened))) {
        throw errors.VOICE_INVALID_STATE();
      }
    }),

  /** What `device.load` needs. Requires a live seat; no rate rule (read). */
  getRouterRtpCapabilities: voiceProcedure.handler(({ context, errors }) =>
    mapVoiceErrors(errors, () => getRouterRtpCapabilities(context.user.id, context.connectionId)),
  ),

  /** One send + one recv per peer; the send side gets the incoming-bitrate backstop. */
  createTransport: voiceProcedure
    .input(z.object({ direction: z.enum(["send", "recv"]) }))
    .use(perUserRatelimit("voiceSignal", voiceSignalLimiter))
    .handler(({ input, context, errors }) =>
      mapVoiceErrors(errors, () =>
        createTransport(context.user.id, context.connectionId, input.direction),
      ),
    ),

  connectTransport: voiceProcedure
    .input(z.object({ transportId: z.string(), dtlsParameters: dtlsParametersSchema }))
    .use(perUserRatelimit("voiceSignal", voiceSignalLimiter))
    .handler(({ input, context, errors }) =>
      mapVoiceErrors(errors, () =>
        connectTransport(
          context.user.id,
          context.connectionId,
          input.transportId,
          input.dtlsParameters,
        ),
      ),
    ),

  /** Enforces 1 audio + ≤1 cam + ≤1 screen per peer; announces room-only producerAdded. */
  produce: voiceProcedure
    .input(
      z
        .object({
          transportId: z.string(),
          kind: z.enum(["audio", "video"]),
          rtpParameters: rtpParametersSchema,
          source: z.enum(["mic", "cam", "screen"]),
        })
        .refine((value) => (value.source === "mic") === (value.kind === "audio"), {
          message: "kind does not match source: mic is audio, cam/screen are video.",
        }),
    )
    .use(perUserRatelimit("voiceSignal", voiceSignalLimiter))
    .handler(({ input, context, errors }) =>
      mapVoiceErrors(errors, () => produce(context.user.id, context.connectionId, input)),
    ),

  closeProducer: voiceProcedure
    .input(z.object({ producerId: z.string() }))
    .use(perUserRatelimit("voiceSignal", voiceSignalLimiter))
    .handler(({ input, context, errors }) =>
      mapVoiceErrors(errors, () =>
        closeProducer(context.user.id, context.connectionId, input.producerId),
      ),
    ),

  /** Created server-side PAUSED (#18); the batched resume is the single activation verb. */
  consume: voiceProcedure
    .input(z.object({ producerId: z.string(), rtpCapabilities: rtpCapabilitiesSchema }))
    .use(perUserRatelimit("voiceConsume", voiceConsumeLimiter))
    .handler(({ input, context, errors }) =>
      mapVoiceErrors(errors, () =>
        consume(context.user.id, context.connectionId, input.producerId, input.rtpCapabilities),
      ),
    ),

  /** Batched; only ever touches the caller's own consumers; no broadcast (#18). */
  setConsumersPaused: voiceProcedure
    .input(z.object({ consumerIds: z.array(z.string()).max(100), paused: z.boolean() }))
    .use(perUserRatelimit("voiceConsume", voiceConsumeLimiter))
    .handler(({ input, context, errors }) =>
      mapVoiceErrors(errors, () =>
        setConsumersPaused(context.user.id, context.connectionId, input.consumerIds, input.paused),
      ),
    ),
};
