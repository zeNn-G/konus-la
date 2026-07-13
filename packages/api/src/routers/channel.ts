import {
  createChannel,
  deleteChannel,
  listChannelsForViewer,
  listGuildMemberUserIds,
  markChannelRead,
  renameChannel,
} from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  protectedProcedure,
  requireChannelMember,
  requireGuildMember,
  requireGuildOwner,
} from "../index";
import { markReadLimiter, perUserRatelimit } from "../ratelimit";
import { publishTo } from "../realtime/publishers";
import { evictVoiceRoom } from "../voice/rooms";

/** Discord-style slugs; the client normalises as-you-type, this is the source of truth. */
const channelNameSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,32}$/, "1–32 characters: lowercase letters, digits, dashes.");

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver's LibsqlError (DrizzleQueryError → cause chain).
  for (let current = error; current instanceof Error; current = current.cause as Error) {
    if (current.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}

/**
 * Guild-channel lifecycle + the viewer's unread state. Create/rename/delete are owner-gated
 * for now — the roles rework ("Phase 3.5") will widen these to admins. Every structural
 * change fans out to all guild members so sidebars stay live.
 */
export const channelRouter = {
  /**
   * Create a guild channel. Names are unique per (guild, kind) → CONFLICT on collision, so a
   * voice `general` may coexist with a text `#general`. `dm` is excluded from `kind`: DMs are
   * created through the dm router (which sets a pair key), and a guild-scoped one would render
   * as an unreachable row. Owner only.
   */
  create: protectedProcedure
    .input(
      z.object({
        guildId: z.string(),
        name: channelNameSchema,
        kind: z.enum(["text", "voice"]).default("text"),
      }),
    )
    .use(requireGuildOwner)
    .handler(async ({ input }) => {
      try {
        const created = await createChannel(input);
        await publishTo(await listGuildMemberUserIds(input.guildId), {
          type: "channel.created",
          guildId: input.guildId,
          channel: {
            id: created.id,
            name: created.name,
            kind: created.kind,
            createdAt: created.createdAt,
          },
        });
        return { id: created.id, name: created.name, kind: created.kind };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ORPCError("CONFLICT", {
            message: "A channel with that name already exists.",
          });
        }
        throw error;
      }
    }),

  /** Rename a channel. Owner only. */
  update: protectedProcedure
    .input(z.object({ guildId: z.string(), channelId: z.string(), name: channelNameSchema }))
    .use(requireGuildOwner)
    .handler(async ({ input }) => {
      try {
        const updated = await renameChannel(input);
        if (!updated) throw new ORPCError("NOT_FOUND", { message: "Channel not found." });
        await publishTo(await listGuildMemberUserIds(input.guildId), {
          type: "channel.updated",
          guildId: input.guildId,
          channel: {
            id: updated.id,
            name: updated.name,
            kind: updated.kind,
            createdAt: updated.createdAt,
          },
        });
        return { ok: true } as const;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ORPCError("CONFLICT", {
            message: "A channel with that name already exists.",
          });
        }
        throw error;
      }
    }),

  /**
   * Hard-delete a channel — its messages cascade away with it, and a voice channel's Room is
   * evicted with it (everyone seated is dropped and their SFU resources released). Owner only.
   */
  delete: protectedProcedure
    .input(z.object({ guildId: z.string(), channelId: z.string() }))
    .use(requireGuildOwner)
    .handler(async ({ input }) => {
      const deleted = await deleteChannel(input.channelId, input.guildId);
      if (!deleted) throw new ORPCError("NOT_FOUND", { message: "Channel not found." });
      // Row first, THEN the room: once the row is gone a concurrent join can no longer
      // re-seat into the doomed room. Evicting first would leave exactly that window open.
      // The deleted row carries its kind, so this costs no extra read.
      if (deleted.kind === "voice") evictVoiceRoom(input.channelId);
      await publishTo(await listGuildMemberUserIds(input.guildId), {
        type: "channel.deleted",
        guildId: input.guildId,
        channelId: input.channelId,
      });
      return { ok: true } as const;
    }),

  /** Channels of a guild + the viewer's unread boolean and mention count. Members only. */
  list: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireGuildMember)
    .handler(async ({ input, context }) => {
      return listChannelsForViewer(input.guildId, context.user.id);
    }),

  /**
   * Advance the read watermark to `messageId` (the newest message the client rendered) and
   * zero the mention badge. Forward-only server-side; a rejected (stale) call is a no-op.
   * The confirmation event goes to the CALLER's other tabs/devices only.
   */
  markRead: protectedProcedure
    .input(z.object({ channelId: z.string(), messageId: z.string() }))
    .use(requireChannelMember)
    .use(perUserRatelimit("markRead", markReadLimiter))
    .handler(async ({ input, context }) => {
      const applied = await markChannelRead({
        userId: context.user.id,
        channelId: input.channelId,
        messageId: input.messageId,
      });
      if (applied) {
        await publishTo([context.user.id], {
          type: "readState.updated",
          channelId: input.channelId,
          lastReadMessageId: input.messageId,
          mentionsCount: 0,
        });
      }
      return { ok: true } as const;
    }),
};
