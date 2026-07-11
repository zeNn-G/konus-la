import type { LoggerContext } from "@orpc/experimental-pino";

export type CreateContextOptions = {
  headers: Headers;
};

/**
 * Base request context. The Better Auth session is resolved lazily inside the auth
 * middleware (see `protectedProcedure`) so public procedures don't pay for `getSession`.
 */
export interface Context extends LoggerContext {
  headers: Headers;
  /**
   * Socket identity, present ONLY for calls arriving over the `/ws` connection (minted at
   * upgrade, passed in by the `websocket.message` handler). Fetch `/rpc` contexts never
   * carry one — `voice.*` procedures gate on this to enforce WS-only signaling (ADR 0007).
   */
  connectionId?: string;
}

export async function createContext({ headers }: CreateContextOptions): Promise<Context> {
  return { headers };
}
