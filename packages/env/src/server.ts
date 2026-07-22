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
    // The address ICE candidates advertise to browsers (ADR 0009). Loopback only works
    // on the dev box itself, so production must set the host's real public IP explicitly.
    PUBLIC_IP:
      process.env.NODE_ENV === "production"
        ? z.string().min(1)
        : z.string().min(1).default("127.0.0.1"),
    // The single UDP+TCP port pair every WebRTC transport multiplexes over (ADR 0009).
    // Announced candidates carry it, so in Docker the host port must equal it.
    MEDIA_PORT: z.coerce.number().int().min(1).max(65_535).default(40000),
    MAX_GUILDS_PER_USER: z.coerce.number().int().positive().default(5),
    MAX_DM_GROUP_SIZE: z.coerce.number().int().min(3).default(10),
    // Server-side ceiling on what one send transport may push at the SFU (spec §Media
    // policy backstop): client encodings are advisory, this makes the cap authoritative.
    MEDIASOUP_MAX_INCOMING_BITRATE: z.coerce.number().int().positive().default(6_500_000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
