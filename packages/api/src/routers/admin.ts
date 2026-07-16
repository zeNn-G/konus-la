import { auth } from "@konus-la/auth";
import { APIError } from "@konus-la/auth/api-error";
import { getUserRole, listBannedUsers } from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { adminProcedure } from "../index";
import { closeUserConnections } from "../realtime/connections";
import { leaveVoice } from "../voice/rooms";

/**
 * Instance-level bans via the Better Auth admin plugin (issue #63, spec §admin router —
 * #50, #52). Instance Owner only. Deliberately NOT audit-logged: instance bans have no
 * guild home — `user.banReason` is the sole paper trail.
 */

/** Better Auth `APIError`s surface as 500s through oRPC — rethrow with a real code. */
function wrapAuthError(error: unknown): never {
  if (error instanceof APIError) {
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
  throw error;
}

export const adminRouter = {
  /**
   * Ban a user from the instance, permanently (`banExpiresIn` omitted on purpose). The
   * reason is required non-empty — it kills Better Auth's `"No reason"` literal and is the
   * only record of why. Order matters: the Better Auth call (which revokes all the
   * target's sessions itself) → instance-wide voice leave → force-close the target's live
   * sockets, whose reconnects then die at the /ws session gate and land the tabs on
   * /login via the session watchdog (#62).
   */
  banUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().trim().min(1, "A ban reason is required.").max(500),
      }),
    )
    .handler(async ({ input, context }) => {
      // Pre-guards Better Auth doesn't provide: no self-ban, no banning another admin.
      if (input.userId === context.user.id) {
        throw new ORPCError("BAD_REQUEST", { message: "You can't ban yourself." });
      }
      const targetRole = await getUserRole(input.userId);
      if (targetRole === null) {
        throw new ORPCError("NOT_FOUND", { message: "User not found." });
      }
      if (targetRole === "admin") {
        throw new ORPCError("FORBIDDEN", { message: "Another admin can't be banned." });
      }

      try {
        // Never flip `banned` directly in the DB — only this call revokes the target's
        // sessions. It authorizes against the calling admin's own session headers.
        await auth.api.banUser({
          body: { userId: input.userId, banReason: input.reason },
          headers: context.headers,
        });
      } catch (error) {
        wrapAuthError(error);
      }

      await leaveVoice(input.userId);
      closeUserConnections(input.userId);
      return { ok: true } as const;
    }),

  /**
   * Lift an instance ban. No teardown — and nothing to restore beyond the flag: the ban
   * never touched memberships, messages, or guild bans, so unban restores, never erases.
   */
  unbanUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .handler(async ({ input, context }) => {
      if ((await getUserRole(input.userId)) === null) {
        throw new ORPCError("NOT_FOUND", { message: "User not found." });
      }
      try {
        await auth.api.unbanUser({
          body: { userId: input.userId },
          headers: context.headers,
        });
      } catch (error) {
        wrapAuthError(error);
      }
      return { ok: true } as const;
    }),

  /** Banned users with their reasons — the admin bans page's list. */
  listBannedUsers: adminProcedure.handler(async () => {
    return listBannedUsers();
  }),
};
