import {
  connectionClosed,
  connectionOpened,
  presenceConnectionClosed,
  presenceConnectionOpened,
  voiceConnectionClosed,
} from "@konus-la/api";
import { createContext } from "@konus-la/api/context";
import { appRouter } from "@konus-la/api/routers/index";
import { auth } from "@konus-la/auth";
import { env } from "@konus-la/env/server";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler as BunWSRPCHandler } from "@orpc/server/bun-ws";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";

import path from "node:path";

import { logger } from "./logger";
import { startSfu } from "./sfu";
import { createStaticHandler } from "./static";

// SFU worker boots with the server and lives for the process (phase-5 spec §Worker
// lifecycle). Fire-and-forget: a failed boot goes through the manager's breaker instead
// of blocking HTTP/WS startup.
startSfu();

const corsPlugin = new CORSPlugin({
  origin: (origin) => (origin === env.CORS_ORIGIN ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST"],
  allowHeaders: ["Content-Type", "Authorization"],
});

const loggingPlugin = new LoggingHandlerPlugin({ logger });

// The ORPC CORSPlugin only covers /rpc. Better Auth's handler (/api/auth/*) needs its own CORS,
// including the custom `x-signup-code` header (which forces a browser preflight on sign-up).
const AUTH_ALLOWED_HEADERS = "Content-Type, Authorization, x-signup-code";

function authCorsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  if (origin === env.CORS_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  return headers;
}

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [corsPlugin, loggingPlugin],
});

const wsHandler = new BunWSRPCHandler(appRouter, {
  plugins: [loggingPlugin],
});

/**
 * Per-connection state stashed at upgrade time. Keeping the upgrade request's headers means
 * `requireAuth` works unchanged over WS (it re-resolves the session per procedure call —
 * that re-check at subscription start is deliberate; see ADR 0005).
 */
type WSData = {
  userId: string;
  headers: Headers;
  /** Socket identity for voice: `voice.*` procedures require it, seats/peers key on it. */
  connectionId: string;
};

const serveStatic = createStaticHandler(path.resolve(import.meta.dir, "../../web/dist"));

const server = Bun.serve<WSData, string>({
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      // Cookies ride the upgrade request, so guard against cross-site WS (CSWSH): a browser
      // always sends Origin here. Absent Origin = non-browser client; the cookie check below
      // still gates it.
      const origin = req.headers.get("origin");
      if (origin && origin !== env.CORS_ORIGIN) {
        return new Response("Forbidden", { status: 403 });
      }

      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) {
        return new Response("Unauthorized", { status: 401 });
      }

      const data: WSData = {
        userId: session.user.id,
        headers: req.headers,
        connectionId: crypto.randomUUID(),
      };
      if (server.upgrade(req, { data })) return;

      return new Response("Upgrade failed", { status: 426 });
    }

    if (url.pathname.startsWith("/api/auth/")) {
      if (req.method === "OPTIONS") {
        const headers = authCorsHeaders(req);
        headers.set("Access-Control-Allow-Methods", "GET, POST");
        headers.set("Access-Control-Allow-Headers", AUTH_ALLOWED_HEADERS);
        headers.set("Access-Control-Max-Age", "86400");
        return new Response(null, { status: 204, headers });
      }

      const response = await auth.handler(req);
      for (const [key, value] of authCorsHeaders(req)) {
        response.headers.set(key, value);
      }
      return response;
    }

    if (url.pathname.startsWith("/rpc")) {
      const context = await createContext({ headers: req.headers });
      const result = await rpcHandler.handle(req, { prefix: "/rpc", context });

      if (result.matched) return result.response;

      return new Response("Not Found", { status: 404 });
    }

    // No DB ping: Bun.serve only starts after migrations succeed, so answering HTTP
    // already means boot completed (phase-8 spec §/health).
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    const staticResponse = await serveStatic(req, url);
    if (staticResponse) return staticResponse;

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      // Only successfully upgraded (= authenticated) sockets reach here.
      connectionOpened(ws.data.userId, ws);
      void presenceConnectionOpened(ws.data.userId).catch((error) => {
        logger.error({ error }, "presence online broadcast failed");
      });
    },
    message(ws, message) {
      wsHandler.message(ws, message, {
        context: { headers: ws.data.headers, connectionId: ws.data.connectionId },
      });
    },
    close(ws) {
      wsHandler.close(ws);
      connectionClosed(ws.data.userId, ws);
      presenceConnectionClosed(ws.data.userId);
      // If this socket owned a voice peer, its seat enters the 30 s grace window.
      voiceConnectionClosed(ws.data.connectionId);
    },
  },
});

logger.info({ port: server.port }, "server listening");
