import { env } from "@konus-la/env/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

export function createDb() {
  const client = createClient({
    url: env.DATABASE_URL,
  });

  return drizzle({ client, schema });
}

export const db = createDb();

// Re-exported AFTER `db` is defined: query helpers and shared constants live here so that
// `@konus-la/auth` and `@konus-la/api` never need to depend on `drizzle-orm` directly.
export * from "./constants";
export * from "./mention";
export * from "./queries/users";
export * from "./queries/signup-code";
export * from "./queries/guild";
export * from "./queries/permissions";
export * from "./queries/roles";
export * from "./queries/channel";
export * from "./queries/chat";
export * from "./queries/dm";
export * from "./queries/moderation";
