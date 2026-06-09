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
}

export async function createContext({ headers }: CreateContextOptions): Promise<Context> {
  return { headers };
}
