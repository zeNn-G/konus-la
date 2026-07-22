import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createMigrationClient, getPendingMigrations } from "@konus-la/db/migrate";
import { pino } from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { MigrationFailedError, runBoot } from "./sequence";

/**
 * Runs the whole boot orchestration against the REAL migrations folder on a throwaway
 * FILE db (`:memory:` cannot work — see packages/api/vitest.setup.ts). `importServer` is
 * a stub, so the env module and the actual server entry are never loaded.
 */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // leave it to OS temp cleanup
    }
  }
});

const silent = pino({ level: "silent" });

function bootFixture(env: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "konus-boot-seq-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "konus.db");
  const importServer = vi.fn(async () => {});
  return {
    dir,
    dbPath,
    importServer,
    deps: {
      env: {
        NODE_ENV: "production",
        APP_URL: "https://chat.example.com",
        PUBLIC_IP: "203.0.113.7",
        DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}`,
        ...env,
      } as NodeJS.ProcessEnv,
      log: silent,
      appVersion: "0.1.0",
      importServer,
    },
  };
}

describe("runBoot", () => {
  test("a fresh production boot migrates, derives env, persists a secret, then serves", async () => {
    const { dir, importServer, deps } = bootFixture();

    await runBoot(deps);

    expect(deps.env.BETTER_AUTH_URL).toBe("https://chat.example.com");
    expect(deps.env.CORS_ORIGIN).toBe("https://chat.example.com");
    expect(deps.env.BETTER_AUTH_SECRET).toBeDefined();
    expect(existsSync(path.join(dir, ".auth-secret"))).toBe(true);

    const backups = readdirSync(path.join(dir, "backups"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^pre-migration-.+-v0\.1\.0\.db$/);

    const client = createMigrationClient(deps.env.DATABASE_URL as string);
    try {
      expect(await getPendingMigrations(client)).toEqual([]);
    } finally {
      client.close();
    }
    expect(importServer).toHaveBeenCalledTimes(1);
  });

  test("a boot with nothing pending takes no new backup", async () => {
    const { dir, deps } = bootFixture();
    await runBoot(deps);

    const second = { ...deps, importServer: vi.fn(async () => {}) };
    await runBoot(second);

    expect(readdirSync(path.join(dir, "backups"))).toHaveLength(1);
    expect(second.importServer).toHaveBeenCalledTimes(1);
  });

  test("a failed migration reports the tag and backup, leaves data untouched, never serves", async () => {
    const { importServer, deps } = bootFixture();

    // Conflicts with the first statement of migration 0000 → the migrate batch fails.
    const seed = createMigrationClient(deps.env.DATABASE_URL as string);
    await seed.execute("CREATE TABLE account (bogus text)");
    seed.close();

    const error = await runBoot(deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationFailedError);
    const failure = error as MigrationFailedError;
    expect(failure.migrationTag).toBe("0000_magenta_may_parker");
    expect(failure.backupPath).toMatch(/pre-migration-.+-v0\.1\.0\.db$/);
    expect(existsSync(failure.backupPath as string)).toBe(true);
    expect(importServer).not.toHaveBeenCalled();

    // Transactional batch + snapshot: nothing was applied.
    const client = createMigrationClient(deps.env.DATABASE_URL as string);
    try {
      expect((await getPendingMigrations(client)).length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  test("production boot without APP_URL fails before touching the database", async () => {
    const { dir, importServer, deps } = bootFixture({ APP_URL: undefined });

    await expect(runBoot(deps)).rejects.toThrow(/APP_URL/);
    expect(importServer).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, "backups"))).toBe(false);
  });

  test("dev boot without APP_URL keeps the existing env untouched", async () => {
    const { importServer, deps } = bootFixture({
      NODE_ENV: "development",
      APP_URL: undefined,
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:3001",
    });

    await runBoot(deps);

    expect(deps.env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(deps.env.CORS_ORIGIN).toBe("http://localhost:3001");
    expect(importServer).toHaveBeenCalledTimes(1);
  });
});
