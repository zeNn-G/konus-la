import { deleteMessageRow, getMessageMeta, recordAuditEntry } from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, requireChannelPermission } from "../index";
import { PERMISSIONS } from "../permissions";
import { modActionLimiter, perUserRatelimit } from "../ratelimit";
import { channelRecipientUserIds, publishTo } from "../realtime/publishers";

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
};
