import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { channelRouter } from "./channel";
import { chatRouter, typingRouter } from "./chat";
import { guildRouter } from "./guild";
import { profileRouter } from "./profile";
import { realtimeRouter } from "./realtime";
import { signupCodeRouter } from "./signup-code";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  signupCode: signupCodeRouter,
  profile: profileRouter,
  guild: guildRouter,
  channel: channelRouter,
  chat: chatRouter,
  typing: typingRouter,
  realtime: realtimeRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
