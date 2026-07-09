import { getPublicUser, searchUsers } from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { perUserRatelimit, userSearchLimiter } from "../ratelimit";

/**
 * Instance-wide user directory. Distinct from `profile` (self-mutations): these procedures
 * read OTHER users' public shapes, powering the new-DM and group-participant pickers.
 */
export const userRouter = {
  /** Prefix search on username/displayName, excluding the caller. Client debounces. */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1, "Type something to search for.").max(32),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .use(perUserRatelimit("userSearch", userSearchLimiter))
    .handler(async ({ input, context }) => {
      return searchUsers({
        query: input.query,
        limit: input.limit,
        excludeUserId: context.user.id,
      });
    }),

  /** One user's public profile shape (DM draft headers). */
  get: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .handler(async ({ input }) => {
      const row = await getPublicUser(input.userId);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "User not found." });
      return row;
    }),
};
