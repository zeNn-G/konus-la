import { pino } from "pino";

// Boot (src/boot.ts) logs on this logger BEFORE `@konus-la/env/server` may validate
// process.env, so NODE_ENV is read raw here — the one sanctioned exception to the
// env-package rule.
const isDev = (process.env.NODE_ENV || "development") !== "production";

export const logger = pino(
  isDev
    ? {
        level: "debug",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        level: "info",
      },
);
