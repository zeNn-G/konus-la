import {
  deleteMessageRow,
  getHistoryPage,
  getMessageMeta,
  insertMessage,
  isGuildMember,
  isGuildOwner,
  listGuildMemberUserIds,
  updateMessage,
} from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, requireChannelMember } from "../index";
import { perUserRatelimit, sendMessageLimiter, typingLimiter } from "../ratelimit";
import type { ChatMessage } from "../realtime/events";
import { publishTo } from "../realtime/publishers";

const contentSchema = z
  .string()
  .max(2000, "Messages are capped at 2000 characters.")
  .refine((value) => value.trim().length > 0, "Message can't be empty.");

const TYPING_TTL_MS = 5_000;

export const chatRouter = {
  /**
   * Post a message. Mentions are parsed + counted inside the insert transaction; the
   * created-event (fanned out to every guild member, author included — that's how the
   * author's own tabs update) carries the full history-row shape so caches insert it as-is.
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        channelId: z.string(),
        content: contentSchema,
        replyToMessageId: z.string().nullish(),
      }),
    )
    .use(requireChannelMember)
    .use(perUserRatelimit("sendMessage", sendMessageLimiter))
    .handler(async ({ input, context }) => {
      const result = await insertMessage({
        channelId: input.channelId,
        guildId: context.channel.guildId,
        authorId: context.user.id,
        content: input.content,
        replyToMessageId: input.replyToMessageId ?? null,
      });
      if (result.status === "invalid_reply") {
        throw new ORPCError("BAD_REQUEST", {
          message: "The message you're replying to no longer exists in this channel.",
        });
      }

      const message: ChatMessage = {
        id: result.message.id,
        channelId: result.message.channelId,
        content: result.message.content,
        createdAt: result.message.createdAt,
        editedAt: result.message.editedAt,
        replyToMessageId: result.message.replyToMessageId,
        author: {
          id: context.user.id,
          username: context.user.username,
          displayName: context.user.name,
          image: context.user.image ?? null,
        },
        replyTo: result.replyTo,
      };

      await publishTo(await listGuildMemberUserIds(context.channel.guildId), {
        type: "message.created",
        guildId: context.channel.guildId,
        message,
        mentionedUserIds: result.mentionedUserIds,
      });

      return message;
    }),

  /** Edit your own message. Sets `editedAt`; mentions are NOT recounted (insert-only). */
  editMessage: protectedProcedure
    .input(z.object({ messageId: z.string(), content: contentSchema }))
    .handler(async ({ input, context }) => {
      const meta = await getMessageMeta(input.messageId);
      if (!meta?.guildId) throw new ORPCError("NOT_FOUND", { message: "Message not found." });
      if (meta.authorId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", { message: "You can only edit your own messages." });
      }
      if (!(await isGuildMember(meta.guildId, context.user.id))) {
        throw new ORPCError("FORBIDDEN");
      }

      const updated = await updateMessage(input.messageId, input.content);
      if (!updated?.editedAt) throw new ORPCError("NOT_FOUND", { message: "Message not found." });

      await publishTo(await listGuildMemberUserIds(meta.guildId), {
        type: "message.updated",
        guildId: meta.guildId,
        channelId: meta.channelId,
        messageId: updated.id,
        content: updated.content,
        editedAt: updated.editedAt,
      });
      return { ok: true } as const;
    }),

  /** Hard-delete a message — allowed for its author or the guild owner. */
  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .handler(async ({ input, context }) => {
      const meta = await getMessageMeta(input.messageId);
      if (!meta?.guildId) throw new ORPCError("NOT_FOUND", { message: "Message not found." });

      const isAuthor =
        meta.authorId === context.user.id && (await isGuildMember(meta.guildId, context.user.id));
      const isOwner = await isGuildOwner(meta.guildId, context.user.id);
      if (!isAuthor && !isOwner) throw new ORPCError("FORBIDDEN");

      await deleteMessageRow(input.messageId);
      await publishTo(await listGuildMemberUserIds(meta.guildId), {
        type: "message.deleted",
        guildId: meta.guildId,
        channelId: meta.channelId,
        messageId: input.messageId,
      });
      return { ok: true } as const;
    }),

  /** One history page, newest first. Cursor = the oldest message id of the previous page. */
  history: protectedProcedure
    .input(
      z.object({
        channelId: z.string(),
        before: z.string().nullish(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .use(requireChannelMember)
    .handler(async ({ input }) => {
      return getHistoryPage({
        channelId: input.channelId,
        before: input.before ?? null,
        limit: input.limit,
      });
    }),
};

export const typingRouter = {
  /**
   * Ephemeral "X is typing" ping to the channel's other members. Nothing is stored; the
   * 5 s `expiresAt` is the entire lifecycle (there is no typing.stop — clients re-send
   * every ~4 s while typing, and a delivered message clears the indicator client-side).
   */
  start: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .use(requireChannelMember)
    .use(perUserRatelimit("typing", typingLimiter))
    .handler(async ({ input, context }) => {
      const memberIds = await listGuildMemberUserIds(context.channel.guildId);
      await publishTo(
        memberIds.filter((id) => id !== context.user.id),
        {
          type: "typing",
          guildId: context.channel.guildId,
          channelId: input.channelId,
          userId: context.user.id,
          username: context.user.username,
          displayName: context.user.name,
          expiresAt: Date.now() + TYPING_TTL_MS,
        },
      );
      return { ok: true } as const;
    }),
};
