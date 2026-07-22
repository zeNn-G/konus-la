import "dotenv/config";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MigrationFailedError, runBoot } from "./boot/sequence";
import { logger } from "./logger";

/**
 * Production entry — the container CMD is `bun apps/server/src/boot.ts`. Runs the boot
 * sequence, then becomes the server by importing the normal entry. Dev keeps running
 * `src/index.ts` directly; nothing here is on the dev path.
 */

const rootPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
) as { version?: string };

try {
  await runBoot({
    env: process.env,
    log: logger,
    appVersion: rootPackage.version ?? "0.0.0",
    importServer: () => import("./index"),
  });
} catch (error) {
  if (error instanceof MigrationFailedError) {
    logger.fatal(
      {
        migration: error.migrationTag,
        pending: error.pendingTags,
        backupPath: error.backupPath,
        err: error.cause,
      },
      "migration failed — data untouched (the migration batch is transactional and a pre-migration snapshot sits next to the DB); roll back to the previous image tag and it boots again",
    );
  } else {
    logger.fatal({ err: error }, "boot failed");
  }
  await new Promise<void>((resolve) => logger.flush(() => resolve()));
  process.exit(1);
}
