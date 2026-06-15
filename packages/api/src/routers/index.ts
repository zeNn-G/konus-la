import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { guildRouter } from "./guild";
import { profileRouter } from "./profile";
import { signupCodeRouter } from "./signup-code";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  signupCode: signupCodeRouter,
  profile: profileRouter,
  guild: guildRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
