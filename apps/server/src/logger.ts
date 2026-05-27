import { env } from "@konus-la/env/server";
import { pino } from "pino";

const isDev = env.NODE_ENV !== "production";

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
