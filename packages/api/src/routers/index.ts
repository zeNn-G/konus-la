import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { channelRouter } from "./channel";
import { chatRouter, typingRouter } from "./chat";
import { dmRouter } from "./dm";
import { guildRouter } from "./guild";
import { profileRouter } from "./profile";
import { realtimeRouter } from "./realtime";
import { signupCodeRouter } from "./signup-code";
import { userRouter } from "./user";
import { voiceRouter } from "./voice";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  signupCode: signupCodeRouter,
  profile: profileRouter,
  user: userRouter,
  guild: guildRouter,
  channel: channelRouter,
  chat: chatRouter,
  typing: typingRouter,
  dm: dmRouter,
  realtime: realtimeRouter,
  voice: voiceRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
