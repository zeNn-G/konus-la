import {
  actorOutranksMember,
  banMember,
  consumeInvite,
  countOwnedGuilds,
  createGuildWithOwner,
  createInvite,
  deleteGuild,
  deleteInvite,
  getEffectivePermissions,
  getGuildForViewer,
  isGuildOwner,
  kickMember,
  leaveGuild,
  listBans,
  listGuildMemberUserIds,
  listGuildMembers,
  listGuildRoles,
  listInvites,
  listUserGuilds,
  recordAuditEntry,
  renameGuild,
  transferOwnership,
  unbanMember,
} from "@konus-la/db";
import { env } from "@konus-la/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  protectedProcedure,
  requireGuildMember,
  requireGuildOwner,
  requireGuildPermission,
} from "../index";
import { ALL_PERMISSIONS, hasPermission, PERMISSIONS } from "../permissions";
import { inviteCreateLimiter, perUserRatelimit } from "../ratelimit";
import { publishTo } from "../realtime/publishers";
import { evictGuildVoiceRooms, evictMemberFromGuildVoice } from "../voice/rooms";

/**
 * Charter hierarchy for member-targeted moderation: owner-target, self-target, and equal
 * rank all fail `actorOutranksMember` as one plain FORBIDDEN, indistinguishable from the
 * permission gate's.
 */
async function assertActorOutranks(
  guildId: string,
  actorId: string,
  targetId: string,
): Promise<void> {
  if (!(await actorOutranksMember(guildId, actorId, targetId))) {
    throw new ORPCError("FORBIDDEN");
  }
}

/** Roster-change fan-out: every remaining member plus the affected user themselves. */
async function publishMemberEvent(
  type: "guild.member.added" | "guild.member.removed",
  guildId: string,
  userId: string,
): Promise<void> {
  await publishTo(new Set([...(await listGuildMemberUserIds(guildId)), userId]), {
    type,
    guildId,
    userId,
  });
}

/**
 * Guild lifecycle + read access. Management procedures are permission-gated per the
 * spec's catalog (invites → MANAGE_INVITES, kick/ban → KICK/BAN_MEMBERS + hierarchy,
 * rename → MANAGE_GUILD); only `transferOwnership` and `delete` stay owner-only, never
 * delegable.
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

  /**
   * Guild header + full member roster (with `roleIds` + `serverMuted`) + the guild's
   * roles + the viewer's owner flag and RESOLVED permission mask. Members only (no peek).
   * Resolved = owner and `ADMINISTRATOR` collapse to all 12 bits here, so the web gates
   * every surface with one uniform `hasPermission(viewer.permissions, bit)` — bypass
   * logic never ships to the client.
   */
  get: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireGuildMember)
    .handler(async ({ input, context }) => {
      const result = await getGuildForViewer(input.guildId, context.user.id);
      if (!result) throw new ORPCError("NOT_FOUND");
      const [members, roles] = await Promise.all([
        listGuildMembers(input.guildId),
        listGuildRoles(input.guildId),
      ]);
      const effective = result.isOwner
        ? ALL_PERMISSIONS
        : await getEffectivePermissions(input.guildId, context.user.id);
      const permissions = hasPermission(effective, PERMISSIONS.ADMINISTRATOR)
        ? ALL_PERMISSIONS
        : effective;
      return {
        guild: result.guild,
        members,
        roles,
        viewer: { isOwner: result.isOwner, permissions },
      };
    }),

  /**
   * Rename a guild. Delegable via MANAGE_GUILD; every member re-reads `guild.get` (and the
   * rail) off the `guild.updated` fan-out.
   */
  update: protectedProcedure
    .input(z.object({ guildId: z.string(), name: z.string().trim().min(1).max(100) }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_GUILD))
    .handler(async ({ input, context }) => {
      const updated = await renameGuild(input.guildId, input.name);
      if (!updated) throw new ORPCError("NOT_FOUND", { message: "Guild not found." });
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "guild.update",
        metadata: { name: [updated.previousName, updated.name] },
      });
      await publishTo(new Set(await listGuildMemberUserIds(input.guildId)), {
        type: "guild.updated",
        guildId: input.guildId,
      });
      return { ok: true } as const;
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
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "guild.transferOwnership",
        targetUserId: input.newOwnerUserId,
      });
      // Every member re-reads guild.get: the new owner gains the settings entry, the old
      // owner's open settings modal closes, and the roster crown moves.
      await publishTo(new Set(await listGuildMemberUserIds(input.guildId)), {
        type: "guild.updated",
        guildId: input.guildId,
      });
      return { ok: true } as const;
    }),

  /**
   * Permanently delete a guild; FK cascades drop all roles, memberships, invites, and bans —
   * and its channels, so its voice Rooms are evicted here rather than left running.
   */
  delete: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireGuildOwner)
    .handler(async ({ input }) => {
      // Snapshot the roster BEFORE deleting — the FK cascade erases the membership rows.
      const memberIds = await listGuildMemberUserIds(input.guildId);
      await deleteGuild(input.guildId);
      // Rows first, then the rooms — same ordering as channel.delete, and the rooms are found
      // in memory by guildId, since the channel rows they name have already cascaded away.
      evictGuildVoiceRooms(input.guildId);
      await publishTo(new Set(memberIds), { type: "guild.deleted", guildId: input.guildId });
      return { ok: true } as const;
    }),

  /** Shareable, multi-use invite codes. Time-only expiry; no max-uses cap. */
  invite: {
    /** Mint an invite. `expiresInSeconds` null/omitted = never expires. MANAGE_INVITES. */
    create: protectedProcedure
      .input(
        z.object({
          guildId: z.string(),
          expiresInSeconds: z.number().int().positive().nullish(),
        }),
      )
      .use(requireGuildPermission(PERMISSIONS.MANAGE_INVITES))
      .use(perUserRatelimit("inviteCreate", inviteCreateLimiter))
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
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "invite.create",
          metadata: {
            inviteId: invite.id,
            code: invite.code,
            expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
          },
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
            await publishMemberEvent("guild.member.added", result.guildId, context.user.id);
            return { guildId: result.guildId, joined: true };
        }
      }),

    /** All invites for a guild (with display-only `usedCount`). MANAGE_INVITES. */
    list: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireGuildPermission(PERMISSIONS.MANAGE_INVITES))
      .handler(async ({ input }) => {
        return listInvites(input.guildId);
      }),

    /** Revoke (hard-delete) an invite. MANAGE_INVITES. */
    revoke: protectedProcedure
      .input(z.object({ guildId: z.string(), inviteId: z.string() }))
      .use(requireGuildPermission(PERMISSIONS.MANAGE_INVITES))
      .handler(async ({ input, context }) => {
        const removed = await deleteInvite(input.inviteId, input.guildId);
        if (!removed) throw new ORPCError("NOT_FOUND", { message: "Invite not found." });
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "invite.revoke",
          metadata: { inviteId: removed.id, code: removed.code },
        });
        return { ok: true } as const;
      }),
  },

  /** Membership moderation. Permission-gated except `leave` (self-service). */
  member: {
    /**
     * Remove a member; they may rejoin. KICK_MEMBERS + hierarchy: `actorOutranksMember`
     * makes owner-target, self-target, and equal rank all fail as one plain FORBIDDEN.
     */
    kick: protectedProcedure
      .input(z.object({ guildId: z.string(), userId: z.string() }))
      .use(requireGuildPermission(PERMISSIONS.KICK_MEMBERS))
      .handler(async ({ input, context }) => {
        await assertActorOutranks(input.guildId, context.user.id, input.userId);
        const removed = await kickMember(input.guildId, input.userId);
        if (!removed) throw new ORPCError("NOT_FOUND", { message: "That user isn't a member." });
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "member.kick",
          targetUserId: input.userId,
        });
        // Row first, then the seat — the peerLeft fan-out reads the roster at publish time
        // and must reach the remaining members, not the kicked one.
        await evictMemberFromGuildVoice(input.userId, input.guildId);
        await publishMemberEvent("guild.member.removed", input.guildId, input.userId);
        return { ok: true } as const;
      }),

    /** Ban a user (drops membership + bars rejoin). BAN_MEMBERS + hierarchy (see kick). */
    ban: protectedProcedure
      .input(
        z.object({
          guildId: z.string(),
          userId: z.string(),
          reason: z.string().trim().max(500).nullish(),
        }),
      )
      .use(requireGuildPermission(PERMISSIONS.BAN_MEMBERS))
      .handler(async ({ input, context }) => {
        await assertActorOutranks(input.guildId, context.user.id, input.userId);
        await banMember({
          guildId: input.guildId,
          userId: input.userId,
          reason: input.reason ?? null,
          bannedByUserId: context.user.id,
        });
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "member.ban",
          targetUserId: input.userId,
          metadata: { reason: input.reason ?? null },
        });
        // Row first, then the seat (see kick) — this also catches a target sitting out the
        // offline grace window: the seat exists with no peer, and must still go.
        await evictMemberFromGuildVoice(input.userId, input.guildId);
        await publishMemberEvent("guild.member.removed", input.guildId, input.userId);
        return { ok: true } as const;
      }),

    /** Lift a ban. BAN_MEMBERS; no hierarchy — the target isn't a member anymore. */
    unban: protectedProcedure
      .input(z.object({ guildId: z.string(), userId: z.string() }))
      .use(requireGuildPermission(PERMISSIONS.BAN_MEMBERS))
      .handler(async ({ input, context }) => {
        const removed = await unbanMember(input.guildId, input.userId);
        if (!removed) throw new ORPCError("NOT_FOUND", { message: "That user isn't banned." });
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "member.unban",
          targetUserId: input.userId,
        });
        return { ok: true } as const;
      }),

    /** Banned users for a guild. BAN_MEMBERS. */
    banList: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireGuildPermission(PERMISSIONS.BAN_MEMBERS))
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
        // Row first, then the seat (see kick) — leaving a guild vacates its voice channel too.
        await evictMemberFromGuildVoice(context.user.id, input.guildId);
        await publishMemberEvent("guild.member.removed", input.guildId, context.user.id);
        return { ok: true } as const;
      }),
  },
};
