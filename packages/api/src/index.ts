import { auth } from "@konus-la/auth";
import {
  getChannel,
  getEffectivePermissions,
  getMemberAccess,
  isGuildMember,
  isGuildOwner,
  userBelongsToChannel,
} from "@konus-la/db";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";
import { hasPermission, PERMISSIONS } from "./permissions";

export type { ChatMessage, EventMap, RealtimeEvent } from "./realtime/events";
export { publisher } from "./realtime/publisher";
export { presenceConnectionClosed, presenceConnectionOpened } from "./realtime/presence";
export { voiceConnectionClosed } from "./voice/rooms";

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
export type AuthedContext = Context & {
  session: SessionData["session"];
  user: SessionData["user"];
};

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

/**
 * Shared core of the two permission gate factories. Order is fixed: membership first
 * (plain FORBIDDEN if absent — non-members never inherit `@everyone` bits, and unknown
 * guilds stay indistinguishable), owner short-circuit, then the effective-bits check
 * passing on `ADMINISTRATOR` or the required bit. Bits are computed fresh per request —
 * no cache.
 */
async function assertGuildPermission(guildId: string, userId: string, bit: number): Promise<void> {
  const access = await getMemberAccess(guildId, userId);
  if (!access) throw new ORPCError("FORBIDDEN");
  if (access.isOwner) return;

  const bits = await getEffectivePermissions(guildId, userId);
  if (!hasPermission(bits, PERMISSIONS.ADMINISTRATOR) && !hasPermission(bits, bit)) {
    throw new ORPCError("FORBIDDEN");
  }
}

/**
 * Permission gate factory for `guildId`-keyed procedures (ADR 0008): registered after
 * `.input()` like the middlewares above, one middleware per gated procedure — it SUBSUMES
 * `requireGuildMember`. See {@link assertGuildPermission} for the check order.
 */
export function requireGuildPermission(bit: number) {
  return os
    .$context<AuthedContext>()
    .middleware(async ({ context, next }, input: { guildId: string }) => {
      await assertGuildPermission(input.guildId, context.user.id, bit);
      return next();
    });
}

/**
 * Permission gate factory for `channelId`-keyed procedures: loads the channel (missing →
 * FORBIDDEN, no-peek), refuses DMs (`guildId` null — there is no DM moderation), then
 * runs the guild permission check against `channel.guildId`. Injects the loaded
 * `channel` so handlers don't re-query, mirroring `requireChannelMember`.
 */
export function requireChannelPermission(bit: number) {
  return os
    .$context<AuthedContext>()
    .middleware(async ({ context, next }, input: { channelId: string }) => {
      const channelRow = await getChannel(input.channelId);
      if (!channelRow) throw new ORPCError("FORBIDDEN");
      if (!channelRow.guildId) throw new ORPCError("FORBIDDEN");

      await assertGuildPermission(channelRow.guildId, context.user.id, bit);
      return next({ context: { channel: channelRow } });
    });
}

/**
 * Channel-scoped membership gate for procedures keyed by `channelId`: loads the channel,
 * requires the caller to belong to it — guild membership for guild channels, a
 * `channelParticipant` row for DMs (`guildId` null) — and injects the loaded `channel`
 * so handlers don't re-query. FORBIDDEN doubles as no-peek for nonexistent channels.
 */
export const requireChannelMember = os
  .$context<AuthedContext>()
  .middleware(async ({ context, next }, input: { channelId: string }) => {
    const channelRow = await getChannel(input.channelId);
    if (!channelRow) throw new ORPCError("FORBIDDEN");

    if (!(await userBelongsToChannel(channelRow.id, channelRow.guildId, context.user.id))) {
      throw new ORPCError("FORBIDDEN");
    }

    return next({ context: { channel: channelRow } });
  });
