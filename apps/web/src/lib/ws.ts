import type { AppRouterClient } from "@konus-la/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import ReconnectingWebSocket from "partysocket/ws";

import { wsUrl } from "@/lib/server-url";
import { attachSessionWatchdog } from "@/lib/session-watchdog";

/**
 * The single /ws signaling socket, shared by the realtime subscription (use-realtime.ts)
 * and the VoiceSession service — voice.* procedures are connection-scoped on the server,
 * so the seat MUST be signaled from the same socket the subscription rides (phase-5 spec
 * §Signaling transport). Lazy singleton: nothing connects until the authenticated shell
 * (or a voice join) first asks for it, and it is never closed — logout is a full page
 * navigation, and the server's grace machinery covers the socket dying with the tab.
 */

export type WsHandle = {
  socket: ReconnectingWebSocket;
  client: AppRouterClient;
};

let handle: WsHandle | null = null;

export function getWs(): WsHandle {
  if (!handle) {
    const socket = new ReconnectingWebSocket(wsUrl, undefined, {
      maxRetries: Number.POSITIVE_INFINITY,
    });
    // partysocket types readyState as plain `number`; structurally it's a WebSocket.
    const link = new RPCLink({ websocket: socket as unknown as WebSocket });
    // Zombie-tab fix: dead-session recovery on socket drops (session-watchdog.ts).
    attachSessionWatchdog(socket);
    handle = { socket, client: createORPCClient(link) };
  }
  return handle;
}

// Dev-only: lets the phase-5 acceptance harness force socket drops (`socket.reconnect()`).
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).__getWs = getWs;
}
