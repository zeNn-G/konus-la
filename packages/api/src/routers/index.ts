import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../index";
import { auditLogRouter } from "./audit-log";
import { channelRouter } from "./channel";
import { chatRouter, typingRouter } from "./chat";
import { dmRouter } from "./dm";
import { guildRouter } from "./guild";
import { modRouter } from "./mod";
import { profileRouter } from "./profile";
import { realtimeRouter } from "./realtime";
import { reportRouter } from "./report";
import { roleRouter } from "./role";
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
  role: roleRouter,
  auditLog: auditLogRouter,
  channel: channelRouter,
  chat: chatRouter,
  mod: modRouter,
  report: reportRouter,
  typing: typingRouter,
  dm: dmRouter,
  realtime: realtimeRouter,
  voice: voiceRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
