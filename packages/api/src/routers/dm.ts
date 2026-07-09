import { env } from "@konus-la/env/server";
import {
  addDmParticipant,
  createDmGroup,
  getDmParticipants,
  leaveDmGroup,
  listChannelParticipantUserIds,
  listDmChannelsForViewer,
  openDmWithUser,
  removeDmParticipant,
  renameDmChannel,
} from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, requireChannelMember } from "../index";
import {
  dmCreateGroupLimiter,
  dmMutateLimiter,
  dmOpenLimiter,
  perUserRatelimit,
} from "../ratelimit";
import { publishTo } from "../realtime/publishers";

/** Trimmed, ≤100 chars, empty collapses to null — group names are labels, not slugs. */
const groupNameSchema = z
  .string()
  .trim()
  .max(100, "Group names are capped at 100 characters.")
  .nullish()
  .transform((value) => (value ? value : null));

/** The group-management procedures only make sense on a group DM (never a 1:1 or guild channel). */
function assertGroupDm(channel: { kind: string; isGroup: boolean }) {
  if (channel.kind !== "dm" || !channel.isGroup) {
    throw new ORPCError("BAD_REQUEST", { message: "This is not a group DM." });
  }
}

export const dmRouter = {
  /**
   * Idempotently open the 1:1 with another user. Deliberately publishes NO event: the draft
   * flow means a channel is created only when a first message immediately follows, and that
   * `message.created` is what populates the recipient's DM list.
   */
  openWithUser: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .use(perUserRatelimit("dmOpen", dmOpenLimiter))
    .handler(async ({ input, context }) => {
      if (input.userId === context.user.id) {
        throw new ORPCError("BAD_REQUEST", { message: "You can't DM yourself." });
      }
      const result = await openDmWithUser({
        selfUserId: context.user.id,
        otherUserId: input.userId,
      });
      if (result.status === "unknown_user") {
        throw new ORPCError("NOT_FOUND", { message: "User not found." });
      }
      return { channelId: result.channelId, created: result.created };
    }),

  /** Create a group DM: caller + ≥2 others, capped at MAX_DM_GROUP_SIZE total. */
  createGroup: protectedProcedure
    .input(z.object({ participantIds: z.array(z.string()).min(2), name: groupNameSchema }))
    .use(perUserRatelimit("dmCreateGroup", dmCreateGroupLimiter))
    .handler(async ({ input, context }) => {
      const others = [...new Set(input.participantIds)].filter((id) => id !== context.user.id);
      if (others.length < 2) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A group DM needs at least two other people.",
        });
      }
      if (others.length + 1 > env.MAX_DM_GROUP_SIZE) {
        throw new ORPCError("FORBIDDEN", {
          message: `Group DMs are capped at ${env.MAX_DM_GROUP_SIZE} people.`,
        });
      }

      const result = await createDmGroup({
        creatorId: context.user.id,
        memberUserIds: others,
        name: input.name,
      });
      if (result.status === "unknown_user") {
        throw new ORPCError("NOT_FOUND", { message: "One of those users doesn't exist." });
      }

      await publishTo([context.user.id, ...others], {
        type: "channel.created",
        guildId: null,
        channel: {
          id: result.channel.id,
          name: result.channel.name,
          kind: result.channel.kind,
          createdAt: result.channel.createdAt,
        },
      });
      return { channelId: result.channel.id };
    }),

  /** Any participant may pull someone in; the newcomer sees the full history. */
  addParticipant: protectedProcedure
    .input(z.object({ channelId: z.string(), userId: z.string() }))
    .use(requireChannelMember)
    .use(perUserRatelimit("dmMutate", dmMutateLimiter))
    .handler(async ({ input, context }) => {
      assertGroupDm(context.channel);
      const result = await addDmParticipant({
        channelId: input.channelId,
        userId: input.userId,
        maxSize: env.MAX_DM_GROUP_SIZE,
      });
      if (result === "unknown_user") {
        throw new ORPCError("NOT_FOUND", { message: "User not found." });
      }
      if (result === "full") {
        throw new ORPCError("FORBIDDEN", {
          message: `Group DMs are capped at ${env.MAX_DM_GROUP_SIZE} people.`,
        });
      }
      if (result === "already_participant") {
        throw new ORPCError("CONFLICT", { message: "They're already in this group." });
      }

      await publishTo(await listChannelParticipantUserIds(input.channelId), {
        type: "dm.participant.added",
        channelId: input.channelId,
        userId: input.userId,
      });
      return { ok: true } as const;
    }),

  /** Owner-only eviction. Removing yourself is `leave`. */
  removeParticipant: protectedProcedure
    .input(z.object({ channelId: z.string(), userId: z.string() }))
    .use(requireChannelMember)
    .use(perUserRatelimit("dmMutate", dmMutateLimiter))
    .handler(async ({ input, context }) => {
      assertGroupDm(context.channel);
      if (context.channel.ownerId !== context.user.id) {
        throw new ORPCError("FORBIDDEN", {
          message: "Only the group owner can remove people.",
        });
      }
      if (input.userId === context.user.id) {
        throw new ORPCError("BAD_REQUEST", { message: "Use leave to remove yourself." });
      }

      const removed = await removeDmParticipant(input.channelId, input.userId);
      if (!removed) throw new ORPCError("NOT_FOUND", { message: "They're not in this group." });

      // Remaining participants refresh the roster; the removed user's own tabs see their
      // userId and drop the conversation entirely.
      await publishTo([...(await listChannelParticipantUserIds(input.channelId)), input.userId], {
        type: "dm.participant.removed",
        channelId: input.channelId,
        userId: input.userId,
      });
      return { ok: true } as const;
    }),

  /**
   * Leave a group. The owner leaving hands off to the longest-standing participant; the
   * last participant leaving deletes the channel (and gets the only `removed` event).
   */
  leave: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .use(requireChannelMember)
    .use(perUserRatelimit("dmMutate", dmMutateLimiter))
    .handler(async ({ input, context }) => {
      assertGroupDm(context.channel);
      const result = await leaveDmGroup({ channelId: input.channelId, userId: context.user.id });
      if (result.status === "not_participant") throw new ORPCError("FORBIDDEN");

      const recipients =
        result.status === "deleted"
          ? [context.user.id]
          : [...result.remainingUserIds, context.user.id];
      await publishTo(recipients, {
        type: "dm.participant.removed",
        channelId: input.channelId,
        userId: context.user.id,
      });
      return { ok: true } as const;
    }),

  /** Any participant may rename a group; null clears back to the participant-names fallback. */
  rename: protectedProcedure
    .input(z.object({ channelId: z.string(), name: groupNameSchema }))
    .use(requireChannelMember)
    .use(perUserRatelimit("dmMutate", dmMutateLimiter))
    .handler(async ({ input, context }) => {
      assertGroupDm(context.channel);
      const updated = await renameDmChannel(input.channelId, input.name);
      if (!updated) throw new ORPCError("NOT_FOUND");

      await publishTo(await listChannelParticipantUserIds(input.channelId), {
        type: "channel.updated",
        guildId: null,
        channel: {
          id: updated.id,
          name: updated.name,
          kind: updated.kind,
          createdAt: updated.createdAt,
        },
      });
      return { ok: true } as const;
    }),

  /** The viewer's conversations, activity-sorted. Empty 1:1s (drafts that never sent) are hidden. */
  list: protectedProcedure.handler(async ({ context }) => {
    return listDmChannelsForViewer(context.user.id);
  }),

  /** One conversation's roster + metadata — the DM view's existence check and header source. */
  get: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .use(requireChannelMember)
    .handler(async ({ input, context }) => {
      if (context.channel.kind !== "dm") throw new ORPCError("BAD_REQUEST");
      return {
        id: context.channel.id,
        isGroup: context.channel.isGroup,
        name: context.channel.name,
        ownerId: context.channel.ownerId,
        participants: await getDmParticipants(input.channelId),
      };
    }),
};
