import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PUBLIC_IP: z.string().default("127.0.0.1"),
    MAX_GUILDS_PER_USER: z.coerce.number().int().positive().default(5),
    MEDIASOUP_RTC_MIN_PORT: z.coerce.number().int().default(40000),
    MEDIASOUP_RTC_MAX_PORT: z.coerce.number().int().default(40100),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
