import { auth } from "@konus-la/auth";
import { isGuildMember, isGuildOwner } from "@konus-la/db";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export type { EventMap } from "./realtime/events";
export { publisher } from "./realtime/publisher";

export const o = os.$context<Context>();

export const publicProcedure = o;

// Resolve the Better Auth session from request headers; expose session + user to the
// procedure (oRPC × Better Auth integration pattern). Throws UNAUTHORIZED when absent.
const requireAuth = o.middleware(async ({ context, next }) => {
  const sessionData = await auth.api.getSession({ headers: context.headers });

  if (!sessionData?.session || !sessionData?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({
    context: {
      session: sessionData.session,
      user: sessionData.user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

// Instance-tier gate: builds on protectedProcedure, then requires the global `admin`
// role (the Instance Owner; see ADR 0002). `context.user` is already authenticated here.
export const adminProcedure = protectedProcedure.use(async ({ context, next }) => {
  if (context.user.role !== "admin") {
    throw new ORPCError("FORBIDDEN");
  }
  return next();
});

// The authenticated context shape that `requireAuth` injects. The per-guild middlewares
// below require it, so they may only be chained onto an already-protected procedure.
type SessionData = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
type AuthedContext = Context & { session: SessionData["session"]; user: SessionData["user"] };

// Per-guild access-control middlewares. Unlike `adminProcedure`, these gate on a
// `guildId` taken from VALIDATED input, so they must be registered AFTER `.input()`:
//   protectedProcedure.input(z.object({ guildId: z.string(), ... })).use(requireGuildOwner)
// oRPC runs a `.use()` placed after `.input()` post-validation and passes the input through;
// the middleware's input type is structurally satisfied by any schema carrying `guildId`.

/** Membership gate: the caller must belong to the guild, else FORBIDDEN (also no-peek). */
export const requireGuildMember = os
  .$context<AuthedContext>()
  .middleware(async ({ context, next }, input: { guildId: string }) => {
    if (!(await isGuildMember(input.guildId, context.user.id))) {
      throw new ORPCError("FORBIDDEN");
    }
    return next();
  });

/** Owner gate: the caller must be the guild's owner (`guild.ownerId`), else FORBIDDEN. */
export const requireGuildOwner = os
  .$context<AuthedContext>()
  .middleware(async ({ context, next }, input: { guildId: string }) => {
    if (!(await isGuildOwner(input.guildId, context.user.id))) {
      throw new ORPCError("FORBIDDEN");
    }
    return next();
  });
