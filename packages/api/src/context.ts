import { auth } from "@konus-la/auth";
import type { LoggerContext } from "@orpc/experimental-pino";

export type CreateContextOptions = {
  headers: Headers;
};

export interface Context extends LoggerContext {
  auth: null;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
}

export async function createContext({ headers }: CreateContextOptions): Promise<Context> {
  const session = await auth.api.getSession({ headers });
  return {
    auth: null,
    session,
  };
}
