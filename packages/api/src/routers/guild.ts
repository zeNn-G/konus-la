import {
  countOwnedGuilds,
  createGuildWithOwner,
  getGuildForViewer,
  listGuildMembers,
  listUserGuilds,
} from "@konus-la/db";
import { env } from "@konus-la/env/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, requireGuildMember } from "../index";

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
};
