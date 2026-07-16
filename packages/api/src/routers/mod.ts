import {
  deleteMessageRow,
  getMessageMeta,
  recordAuditEntry,
  setMemberServerMuted,
} from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  assertActorOutranks,
  protectedProcedure,
  requireChannelPermission,
  requireGuildPermission,
} from "../index";
import { PERMISSIONS } from "../permissions";
import { modActionLimiter, perUserRatelimit } from "../ratelimit";
import { channelRecipientUserIds, publishTo } from "../realtime/publishers";
import { disconnectMemberFromGuildVoice, setServerMute } from "../voice/rooms";

export const modRouter = {
  /**
   * Moderator hard-delete of another member's message (spec §mod router): gated
   * MANAGE_MESSAGES on the channel's guild — no hierarchy check, the charter lists
   * hierarchy for member-targeted acts only. DM channels never reach the handler
   * (requireChannelPermission refuses guildId null). Own-message deletion stays on
   * chat.deleteMessage: author-only and unaudited.
   */
  deleteMessage: protectedProcedure
    .input(
      z.object({
        channelId: z.string(),
        messageId: z.string(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .use(requireChannelPermission(PERMISSIONS.MANAGE_MESSAGES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      // The permission gate ran against input.channelId, so a message living elsewhere
      // must not ride this call — refuse rather than delete across the gate's scope.
      const meta = await getMessageMeta(input.messageId);
      if (!meta || meta.channelId !== input.channelId) {
        throw new ORPCError("NOT_FOUND", { message: "Message not found." });
      }

      await deleteMessageRow(input.messageId);
      // The snippet is the only surviving record of a hard-deleted message.
      await recordAuditEntry({
        guildId: context.channel.guildId,
        actorId: context.user.id,
        action: "message.modDelete",
        targetUserId: meta.authorId,
        targetChannelId: input.channelId,
        targetMessageId: input.messageId,
        metadata: { reason: input.reason || null, contentSnippet: meta.content.slice(0, 200) },
      });
      await publishTo(await channelRecipientUserIds(context.channel), {
        type: "message.deleted",
        guildId: context.channel.guildId,
        channelId: input.channelId,
        messageId: input.messageId,
      });
      return { ok: true } as const;
    }),

  /**
   * Flip a member's persistent server-mute (spec §Server-mute, #49): the flag lives on the
   * membership and outlives seats, guild switches, and restarts. Silent for the target by
   * design — no toast; their locked mic button and own-tile badge are the signal.
   */
  serverMute: protectedProcedure
    .input(z.object({ guildId: z.string(), userId: z.string(), muted: z.boolean() }))
    .use(requireGuildPermission(PERMISSIONS.MUTE_MEMBERS))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      await assertActorOutranks(input.guildId, context.user.id, input.userId);
      if (!(await setMemberServerMuted(input.guildId, input.userId, input.muted))) {
        throw new ORPCError("NOT_FOUND", { message: "Member not found." });
      }
      await setServerMute(input.guildId, input.userId, input.muted);
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "member.serverMute",
        targetUserId: input.userId,
        metadata: { muted: input.muted },
      });
      return { ok: true } as const;
    }),

  /**
   * Evict a member's voice seat (spec §mod router): rides the guild-scoped eviction path
   * (#42) — `voice.peerLeft` flows naturally, plus a self-only stand-down so the target's
   * client doesn't auto-rejoin (see disconnectMemberFromGuildVoice). The target may
   * deliberately rejoin — a disconnect, not a ban. An unseated target is NOT_FOUND: there
   * is nothing to disconnect, and a no-op must not leave an audit entry claiming otherwise.
   */
  disconnectVoice: protectedProcedure
    .input(z.object({ guildId: z.string(), userId: z.string() }))
    .use(requireGuildPermission(PERMISSIONS.MOVE_MEMBERS))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      await assertActorOutranks(input.guildId, context.user.id, input.userId);
      const channelId = await disconnectMemberFromGuildVoice(input.userId, input.guildId);
      if (!channelId) {
        throw new ORPCError("NOT_FOUND", { message: "Member is not in a voice channel." });
      }
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "member.voiceDisconnect",
        targetUserId: input.userId,
        targetChannelId: channelId,
      });
      return { ok: true } as const;
    }),
};
