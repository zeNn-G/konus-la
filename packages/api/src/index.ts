import { auth } from "@konus-la/auth";
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
