import { updateDisplayName } from "@konus-la/db";
import { z } from "zod";

import { protectedProcedure } from "../index";

/** Self-service profile edits. Username is immutable, so only displayName is editable in v1. */
export const profileRouter = {
  update: protectedProcedure
    .input(z.object({ displayName: z.string().trim().min(1).max(60) }))
    .handler(async ({ input, context }) => {
      await updateDisplayName(context.user.id, input.displayName);
      return { displayName: input.displayName };
    }),
};
