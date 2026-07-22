import path from "node:path";

import {
  backupDatabase,
  createMigrationClient,
  getPendingMigrations,
  pruneBackups,
  runMigrations,
} from "@konus-la/db/migrate";
import type { Logger } from "pino";

import { detectPublicIp } from "./public-ip";
import { ensureAuthSecret } from "./secret";

/** A precondition the operator must fix (missing/unusable config) — boot exits 1. */
export class BootError extends Error {}

export class MigrationFailedError extends Error {
  /**
   * Where the rolled-back batch restarts from. With one migration pending this IS the
   * failed one; with several, the failing statement may sit in any of `pendingTags`
   * (the batch is atomic, so all of them rolled back).
   */
  readonly migrationTag: string;
  readonly pendingTags: string[];
  readonly backupPath: string;

  constructor(migrationTag: string, pendingTags: string[], backupPath: string, cause: unknown) {
    super(`migration failed while applying ${pendingTags.join(", ")}`, { cause });
    this.migrationTag = migrationTag;
    this.pendingTags = pendingTags;
    this.backupPath = backupPath;
  }
}

const DEFAULT_BACKUP_RETENTION = 5;

export type BootDeps = {
  /** Injected `process.env` — boot reads and derives on it BEFORE env validation. */
  env: NodeJS.ProcessEnv;
  log: Logger;
  /** Root package.json version — stamps backups with the version a rollback returns to. */
  appVersion: string;
  /** Thunk for the server entry, so importing (= env validation) stays the last step. */
  importServer: () => Promise<unknown>;
};

/**
 * The production boot sequence (phase-8 spec §Boot sequence): secret → derive → IP
 * detect → conditional backup+prune → migrate → serve. Every auto-decision logs exactly
 * one line — the smoke-test runbook greps them.
 */
export async function runBoot({ env, log, appVersion, importServer }: BootDeps) {
  const isProduction = env.NODE_ENV === "production";

  if (!env.DATABASE_URL) throw new BootError("DATABASE_URL is required to boot");
  const dataDir = path.dirname(databaseFilePath(env.DATABASE_URL));

  const secretPath = path.join(dataDir, ".auth-secret");
  const secretSource = ensureAuthSecret({ env, secretPath });
  log.info(
    { source: secretSource, ...(secretSource === "env" ? {} : { path: secretPath }) },
    secretSource === "generated"
      ? "auth secret: generated and persisted"
      : `auth secret: from ${secretSource}`,
  );

  if (env.APP_URL) {
    env.BETTER_AUTH_URL = env.APP_URL;
    env.CORS_ORIGIN = env.APP_URL;
    log.info({ appUrl: env.APP_URL }, "derived BETTER_AUTH_URL and CORS_ORIGIN from APP_URL");
  } else if (isProduction) {
    throw new BootError("APP_URL is required for production boot");
  }

  const publicIp = await detectPublicIp({ publicIpEnv: env.PUBLIC_IP, isProduction });
  env.PUBLIC_IP = publicIp.address;
  log.info({ source: publicIp.source, address: publicIp.address }, "public IP resolved");

  const client = createMigrationClient(env.DATABASE_URL);
  try {
    const pending = await getPendingMigrations(client);
    if (pending.length === 0) {
      log.info("no migration pending");
    } else {
      const backupsDir = path.join(dataDir, "backups");
      const retention = backupRetention(env.BACKUP_RETENTION);
      const backupPath = await backupDatabase(client, { backupsDir, appVersion });
      const pruned = pruneBackups(backupsDir, retention);
      log.info({ backupPath, retention, pruned: pruned.length }, "pre-migration backup created");

      try {
        await runMigrations(client);
      } catch (error) {
        const stillPending = await getPendingMigrations(client).catch(() => pending);
        throw new MigrationFailedError(
          stillPending[0] ?? pending[0] ?? "unknown",
          stillPending,
          backupPath,
          error,
        );
      }
      for (const tag of pending) log.info({ migration: tag }, "migration applied");
    }
  } finally {
    client.close();
  }

  await importServer();
}

/**
 * Path of the SQLite file behind a libsql `file:` URL. Boot needs a real local file —
 * the secret and backups live next to it — so any other scheme is a config error.
 */
function databaseFilePath(dbUrl: string): string {
  if (!dbUrl.startsWith("file:")) {
    throw new BootError(`boot requires a file: DATABASE_URL, got "${dbUrl}"`);
  }
  let file = dbUrl.slice("file:".length);
  if (file.startsWith("//")) file = file.slice(2);
  // file:///D:/... yields /D:/... on Windows — drop the leading slash.
  if (/^\/[A-Za-z]:/.test(file)) file = file.slice(1);
  return path.resolve(file);
}

function backupRetention(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BACKUP_RETENTION;
}
