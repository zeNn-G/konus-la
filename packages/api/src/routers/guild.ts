import {
  banMember,
  consumeInvite,
  countOwnedGuilds,
  createGuildWithOwner,
  createInvite,
  deleteGuild,
  deleteInvite,
  getGuildForViewer,
  isGuildOwner,
  kickMember,
  leaveGuild,
  listBans,
  listGuildMembers,
  listInvites,
  listUserGuilds,
  transferOwnership,
  unbanMember,
} from "@konus-la/db";
import { env } from "@konus-la/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, requireGuildMember, requireGuildOwner } from "../index";

/**
 * Guild lifecycle + read access. Per-guild authorization is enforced by the
 * `requireGuildMember` / `requireGuildOwner` middlewares; management procedures
 * (invites, moderation, transfer, delete) are owner-gated.
 */
export const guildRouter = {
  /** Create a guild (and become its owner). Rejected once the owned-guild cap is reached. */
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100) }))
    .handler(async ({ input, context }) => {
      const owned = await countOwnedGuilds(context.user.id);
      if (owned >= env.MAX_GUILDS_PER_USER) {
        throw new ORPCError("FORBIDDEN", {
          message: `You can own at most ${env.MAX_GUILDS_PER_USER} guilds.`,
        });
      }
      const created = await createGuildWithOwner({
        name: input.name,
        ownerUserId: context.user.id,
      });
      return { id: created.id, name: created.name, icon: created.icon };
    }),

  /** Guilds the caller belongs to (drives the rail). */
  list: protectedProcedure.handler(async ({ context }) => {
    return listUserGuilds(context.user.id);
  }),

  /** Guild header + full member roster + the viewer's owner flag. Members only (no peek). */
  get: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireGuildMember)
    .handler(async ({ input, context }) => {
      const result = await getGuildForViewer(input.guildId, context.user.id);
      if (!result) throw new ORPCError("NOT_FOUND");
      const members = await listGuildMembers(input.guildId);
      return { guild: result.guild, members, viewer: { isOwner: result.isOwner } };
    }),

  /**
   * Hand ownership to another member. The target must already be a member; the old owner
   * stays an ordinary member afterwards (single-column `ownerId` update). Owner only.
   */
  transferOwnership: protectedProcedure
    .input(z.object({ guildId: z.string(), newOwnerUserId: z.string() }))
    .use(requireGuildOwner)
    .handler(async ({ input, context }) => {
      if (input.newOwnerUserId === context.user.id) {
        throw new ORPCError("BAD_REQUEST", { message: "You already own this guild." });
      }
      const transferred = await transferOwnership(input.guildId, input.newOwnerUserId);
      if (!transferred) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The new owner must already be a member of the guild.",
        });
      }
      return { ok: true } as const;
    }),

  /** Permanently delete a guild; FK cascades drop all roles, memberships, invites, and bans. */
  delete: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireGuildOwner)
    .handler(async ({ input }) => {
      await deleteGuild(input.guildId);
      return { ok: true } as const;
    }),

  /** Shareable, multi-use invite codes. Time-only expiry; no max-uses cap. */
  invite: {
    /** Mint an invite. `expiresInSeconds` null/omitted = never expires. Owner only. */
    create: protectedProcedure
      .input(
        z.object({
          guildId: z.string(),
          expiresInSeconds: z.number().int().positive().nullish(),
        }),
      )
      .use(requireGuildOwner)
      .handler(async ({ input, context }) => {
        const expiresAt =
          input.expiresInSeconds != null
            ? new Date(Date.now() + input.expiresInSeconds * 1000)
            : null;
        const invite = await createInvite({
          guildId: input.guildId,
          createdByUserId: context.user.id,
          expiresAt,
        });
        return { id: invite.id, code: invite.code, expiresAt: invite.expiresAt };
      }),

    /**
     * Redeem an invite code to join. Any authenticated user. Rejects invalid/expired codes
     * and banned users; joining when already a member is an idempotent no-op (`joined: false`).
     */
    consume: protectedProcedure
      .input(z.object({ code: z.string().trim().min(1) }))
      .handler(async ({ input, context }) => {
        const result = await consumeInvite(input.code, context.user.id);
        switch (result.status) {
          case "invalid":
            throw new ORPCError("NOT_FOUND", { message: "Invalid or expired invite code." });
          case "banned":
            throw new ORPCError("FORBIDDEN", { message: "You are banned from this guild." });
          case "already_member":
            return { guildId: result.guildId, joined: false };
          case "ok":
            return { guildId: result.guildId, joined: true };
        }
      }),

    /** All invites for a guild (with display-only `usedCount`). Owner only. */
    list: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireGuildOwner)
      .handler(async ({ input }) => {
        return listInvites(input.guildId);
      }),

    /** Revoke (hard-delete) an invite. Owner only. */
    revoke: protectedProcedure
      .input(z.object({ guildId: z.string(), inviteId: z.string() }))
      .use(requireGuildOwner)
      .handler(async ({ input }) => {
        const removed = await deleteInvite(input.inviteId, input.guildId);
        if (!removed) throw new ORPCError("NOT_FOUND", { message: "Invite not found." });
        return { ok: true } as const;
      }),
  },

  /** Membership moderation. Owner-gated except `leave` (self-service). */
  member: {
    /** Remove a member; they may rejoin. The owner can't be targeted. Owner only. */
    kick: protectedProcedure
      .input(z.object({ guildId: z.string(), userId: z.string() }))
      .use(requireGuildOwner)
      .handler(async ({ input, context }) => {
        // The caller is the owner (gate above), so target === owner iff target === caller.
        if (input.userId === context.user.id) {
          throw new ORPCError("BAD_REQUEST", { message: "The owner can't be removed." });
        }
        const removed = await kickMember(input.guildId, input.userId);
        if (!removed) throw new ORPCError("NOT_FOUND", { message: "That user isn't a member." });
        return { ok: true } as const;
      }),

    /** Ban a user (drops membership + bars rejoin). The owner can't be targeted. Owner only. */
    ban: protectedProcedure
      .input(
        z.object({
          guildId: z.string(),
          userId: z.string(),
          reason: z.string().trim().max(500).nullish(),
        }),
      )
      .use(requireGuildOwner)
      .handler(async ({ input, context }) => {
        if (input.userId === context.user.id) {
          throw new ORPCError("BAD_REQUEST", { message: "The owner can't be banned." });
        }
        await banMember({
          guildId: input.guildId,
          userId: input.userId,
          reason: input.reason ?? null,
          bannedByUserId: context.user.id,
        });
        return { ok: true } as const;
      }),

    /** Lift a ban. Owner only. */
    unban: protectedProcedure
      .input(z.object({ guildId: z.string(), userId: z.string() }))
      .use(requireGuildOwner)
      .handler(async ({ input }) => {
        const removed = await unbanMember(input.guildId, input.userId);
        if (!removed) throw new ORPCError("NOT_FOUND", { message: "That user isn't banned." });
        return { ok: true } as const;
      }),

    /** Banned users for a guild. Owner only. */
    banList: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireGuildOwner)
      .handler(async ({ input }) => {
        return listBans(input.guildId);
      }),

    /** Leave a guild (self only). The owner must transfer ownership or delete instead. */
    leave: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireGuildMember)
      .handler(async ({ input, context }) => {
        if (await isGuildOwner(input.guildId, context.user.id)) {
          throw new ORPCError("FORBIDDEN", {
            message: "The owner can't leave; transfer ownership or delete the guild.",
          });
        }
        await leaveGuild(input.guildId, context.user.id);
        return { ok: true } as const;
      }),
  },
};
