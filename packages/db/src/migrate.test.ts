import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { afterEach, describe, expect, test } from "vitest";

import {
  backupDatabase,
  getPendingMigrations,
  migrationsFolder,
  pruneBackups,
  runMigrations,
} from "./migrate";

/**
 * Suites run against tiny fixture migration folders written per test, so expectations are
 * independent literals and a failing migration can be crafted on purpose. One smoke test
 * at the bottom covers the real `src/migrations` folder. Temp FILE dbs, never `:memory:`
 * (see vitest.setup.ts in packages/api for why).
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // leave stragglers to OS temp cleanup (Windows can hold file handles open)
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "konus-boot-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function openDb(dir: string): Client {
  const client = createClient({ url: `file:${path.join(dir, "test.db").replace(/\\/g, "/")}` });
  cleanups.push(() => client.close());
  return client;
}

/** Write a drizzle-shaped migrations folder: a meta/_journal.json plus one .sql per tag. */
function writeMigrationsFixture(entries: Array<{ tag: string; when: number; sql: string }>): string {
  const dir = tempDir();
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: entries.map((e, idx) => ({ idx, version: "6", when: e.when, tag: e.tag, breakpoints: true })),
    }),
  );
  for (const e of entries) {
    writeFileSync(path.join(dir, `${e.tag}.sql`), e.sql);
  }
  return dir;
}

const FIRST = { tag: "0000_first", when: 100, sql: "CREATE TABLE alpha (id text PRIMARY KEY);" };
const SECOND = { tag: "0001_second", when: 200, sql: "ALTER TABLE alpha ADD COLUMN name text;" };

describe("getPendingMigrations", () => {
  test("reports every migration pending on a fresh database", async () => {
    const folder = writeMigrationsFixture([FIRST, SECOND]);
    const client = openDb(tempDir());

    expect(await getPendingMigrations(client, folder)).toEqual(["0000_first", "0001_second"]);
  });

  test("reports only migrations newer than the last applied one", async () => {
    const client = openDb(tempDir());
    await runMigrations(client, writeMigrationsFixture([FIRST]));

    const folder = writeMigrationsFixture([FIRST, SECOND]);
    expect(await getPendingMigrations(client, folder)).toEqual(["0001_second"]);
  });

  test("reports nothing pending once every migration is applied", async () => {
    const folder = writeMigrationsFixture([FIRST, SECOND]);
    const client = openDb(tempDir());
    await runMigrations(client, folder);

    expect(await getPendingMigrations(client, folder)).toEqual([]);
  });
});

describe("backupDatabase", () => {
  test("snapshots the live database into a version-stamped file", async () => {
    const dir = tempDir();
    const client = openDb(dir);
    await runMigrations(client, writeMigrationsFixture([FIRST]));
    await client.execute("INSERT INTO alpha (id) VALUES ('row-1')");

    const backupsDir = path.join(dir, "backups");
    const backupPath = await backupDatabase(client, {
      backupsDir,
      appVersion: "1.2.3",
      timestamp: new Date("2026-07-22T10:15:30.123Z"),
    });

    expect(backupPath).toBe(path.join(backupsDir, "pre-migration-2026-07-22T10-15-30-123Z-v1.2.3.db"));
    const restored = createClient({ url: `file:${backupPath.replace(/\\/g, "/")}` });
    cleanups.push(() => restored.close());
    const rows = await restored.execute("SELECT id FROM alpha");
    expect(rows.rows.map((r) => r.id)).toEqual(["row-1"]);
  });
});

describe("pruneBackups", () => {
  test("keeps the newest N backups and deletes the rest", () => {
    const backupsDir = tempDir();
    const names = [
      "pre-migration-2026-07-01T00-00-00-000Z-v0.1.0.db",
      "pre-migration-2026-07-02T00-00-00-000Z-v0.1.0.db",
      "pre-migration-2026-07-03T00-00-00-000Z-v0.2.0.db",
      "pre-migration-2026-07-04T00-00-00-000Z-v0.2.0.db",
    ];
    for (const name of names) writeFileSync(path.join(backupsDir, name), "");
    writeFileSync(path.join(backupsDir, "unrelated.txt"), "");

    const deleted = pruneBackups(backupsDir, 2);

    expect(deleted).toEqual([path.join(backupsDir, names[0] as string), path.join(backupsDir, names[1] as string)]);
    expect(readdirSync(backupsDir).sort()).toEqual([names[2], names[3], "unrelated.txt"].sort());
  });

  test("is a no-op when the backups directory does not exist yet", () => {
    expect(pruneBackups(path.join(tempDir(), "missing"), 5)).toEqual([]);
  });
});

describe("real migrations folder", () => {
  test("a fresh database migrates to zero pending", async () => {
    const client = openDb(tempDir());

    expect((await getPendingMigrations(client, migrationsFolder)).length).toBeGreaterThan(0);
    await runMigrations(client, migrationsFolder);
    expect(await getPendingMigrations(client, migrationsFolder)).toEqual([]);
  });
});
