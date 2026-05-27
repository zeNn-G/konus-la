import { createContext } from "@konus-la/api/context";
import { appRouter } from "@konus-la/api/routers/index";
import { auth } from "@konus-la/auth";
import { env } from "@konus-la/env/server";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler as BunWSRPCHandler } from "@orpc/server/bun-ws";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";

import { logger } from "./logger";

const corsPlugin = new CORSPlugin({
  origin: (origin) => (origin === env.CORS_ORIGIN ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST"],
  allowHeaders: ["Content-Type", "Authorization"],
});

const loggingPlugin = new LoggingHandlerPlugin({ logger });

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [corsPlugin, loggingPlugin],
});

const wsHandler = new BunWSRPCHandler(appRouter, {
  plugins: [loggingPlugin],
});

const server = Bun.serve({
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;

      return new Response("Upgrade failed", { status: 426 });
    }

    if (url.pathname.startsWith("/api/auth/")) {
      return auth.handler(req);
    }

    if (url.pathname.startsWith("/rpc")) {
      const context = await createContext({ headers: req.headers });
      const result = await rpcHandler.handle(req, { prefix: "/rpc", context });

      if (result.matched) return result.response;

      return new Response("Not Found", { status: 404 });
    }

    if (url.pathname === "/") {
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    message(ws, message) {
      wsHandler.message(ws, message, { context: { auth: null, session: null } });
    },
    close(ws) {
      wsHandler.close(ws);
    },
  },
});

logger.info({ port: server.port }, "server listening");
