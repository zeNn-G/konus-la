import { listAuditEntries } from "@konus-la/db";
import { z } from "zod";

import { protectedProcedure, requireGuildPermission } from "../index";
import { PERMISSIONS } from "../permissions";

/**
 * Read access to a guild's forensic audit log (charter 7). Reads only — entries are
 * recorded inside the mutating procedures via `recordAuditEntry`, and there are no
 * realtime events for them: the view refetches fresh on open.
 */
export const auditLogRouter = {
  /** One page, newest first — the `chat.history` cursor pattern. VIEW_AUDIT_LOG. */
  list: protectedProcedure
    .input(
      z.object({
        guildId: z.string(),
        before: z.string().nullish(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .use(requireGuildPermission(PERMISSIONS.VIEW_AUDIT_LOG))
    .handler(async ({ input }) => {
      return listAuditEntries({
        guildId: input.guildId,
        before: input.before ?? null,
        limit: input.limit,
      });
    }),
};
