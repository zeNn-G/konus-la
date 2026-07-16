import {
  countUnresolvedReports,
  createReport,
  getMessageMeta,
  isGuildMember,
  listReports,
  listUsersWithPermission,
  recordAuditEntry,
  resolveReport,
} from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure, requireGuildPermission } from "../index";
import { PERMISSIONS } from "../permissions";
import { modActionLimiter, perUserRatelimit, reportCreateLimiter } from "../ratelimit";
import { publishTo } from "../realtime/publishers";

/**
 * `report.changed` goes to the permission-derived recipient set — owner ∪ ADMINISTRATOR ∪
 * MANAGE_REPORTS holders, computed at publish time (the db helper folds the owner in; the
 * ADMINISTRATOR bit is OR'd here, where bit meaning lives). Non-holders never receive it.
 */
async function publishReportChanged(guildId: string): Promise<void> {
  const recipients = await listUsersWithPermission(
    guildId,
    PERMISSIONS.MANAGE_REPORTS | PERMISSIONS.ADMINISTRATOR,
  );
  await publishTo(recipients, { type: "report.changed", guildId });
}

export const reportRouter = {
  /**
   * File a report against a guild message (spec §report router): open to any member of the
   * message's guild — DM messages are never reportable (FORBIDDEN, like every DM-moderation
   * path). Snapshots the author and content at report time, so the report survives the
   * message's hard deletion. Unknown messages answer the same plain FORBIDDEN (no-peek).
   * The limiter sits BEFORE the checks (they're message-keyed, in-handler): refused
   * attempts spend budget too, which only ever throttles someone probing the gate.
   */
  create: protectedProcedure
    .input(z.object({ messageId: z.string(), reason: z.string().trim().min(1).max(500) }))
    .use(perUserRatelimit("reportCreate", reportCreateLimiter))
    .handler(async ({ input, context }) => {
      const meta = await getMessageMeta(input.messageId);
      if (!meta || !meta.guildId) throw new ORPCError("FORBIDDEN");
      if (!(await isGuildMember(meta.guildId, context.user.id))) {
        throw new ORPCError("FORBIDDEN");
      }

      await createReport({
        guildId: meta.guildId,
        channelId: meta.channelId,
        messageId: meta.id,
        messageAuthorId: meta.authorId,
        messageContent: meta.content,
        reason: input.reason,
        reporterId: context.user.id,
      });
      await publishReportChanged(meta.guildId);
      return { ok: true } as const;
    }),

  /** The guild's reports, newest first — the inbox view (MANAGE_REPORTS). */
  list: protectedProcedure
    .input(z.object({ guildId: z.string(), resolved: z.boolean().optional() }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_REPORTS))
    .handler(({ input }) => listReports(input)),

  /** Unresolved reports in the guild — feeds the inbox badge (MANAGE_REPORTS). */
  unresolvedCount: protectedProcedure
    .input(z.object({ guildId: z.string() }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_REPORTS))
    .handler(async ({ input }) => ({ count: await countUnresolvedReports(input.guildId) })),

  /**
   * Mark a report resolved (spec §report router) — a mark ONLY, no forced action on the
   * message or its author; audited as `report.resolve`. Racing moderators are safe: only
   * the first resolve writes the mark and its audit entry, later calls succeed as no-ops.
   */
  resolve: protectedProcedure
    .input(z.object({ guildId: z.string(), reportId: z.string() }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_REPORTS))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const outcome = await resolveReport({ ...input, resolvedById: context.user.id });
      if (outcome === "missing") {
        throw new ORPCError("NOT_FOUND", { message: "Report not found." });
      }
      if (outcome === "resolved") {
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "report.resolve",
          metadata: { reportId: input.reportId },
        });
        await publishReportChanged(input.guildId);
      }
      return { ok: true } as const;
    }),
};
