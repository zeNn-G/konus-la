import { createCode, listCodes, deleteUnusedCode } from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { adminProcedure } from "../index";

/** Signup-code management. Instance Owner only (adminProcedure gates on the global `admin` role). */
export const signupCodeRouter = {
  create: adminProcedure
    .input(z.object({ expiresAt: z.date().nullish() }))
    .handler(async ({ input, context }) => {
      const row = await createCode({
        createdByUserId: context.user.id,
        expiresAt: input.expiresAt ?? null,
      });
      return { id: row.id, code: row.code, expiresAt: row.expiresAt };
    }),

  list: adminProcedure.handler(async () => {
    return listCodes();
  }),

  revoke: adminProcedure.input(z.object({ id: z.string() })).handler(async ({ input }) => {
    const removed = await deleteUnusedCode(input.id);
    if (!removed) {
      throw new ORPCError("NOT_FOUND", {
        message: "No unused code with that id (already claimed codes can't be revoked).",
      });
    }
    return { ok: true } as const;
  }),
};
