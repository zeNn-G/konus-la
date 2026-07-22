import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/**
 * Boot-time migration helpers for `apps/server/src/boot.ts`. Everything here is env-free
 * (no `@konus-la/env` import) because boot runs BEFORE the env module validates
 * `process.env` — the client/url is always passed in. Living here keeps `drizzle-orm`
 * out of consumers, same rule as the query helpers.
 */

export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export function createMigrationClient(url: string): Client {
  return createClient({ url });
}

type JournalEntry = { tag: string; when: number };

function readJournal(folder: string): JournalEntry[] {
  const raw = readFileSync(path.join(folder, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(raw) as { entries: JournalEntry[] };
  return journal.entries;
}

/**
 * Journal entries drizzle's `migrate()` would apply, in order. Mirrors the migrator's own
 * predicate exactly: an entry is pending when its `when` is newer than the last
 * `__drizzle_migrations.created_at` (a missing table means everything is pending).
 */
export async function getPendingMigrations(
  client: Client,
  folder = migrationsFolder,
): Promise<string[]> {
  const entries = readJournal(folder);

  const table = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  );
  let lastApplied: number | undefined;
  if (table.rows.length > 0) {
    const result = await client.execute(
      "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    );
    const row = result.rows[0];
    if (row) lastApplied = Number(row.created_at);
  }

  return entries
    .filter((entry) => lastApplied === undefined || lastApplied < entry.when)
    .map((entry) => entry.tag);
}

/**
 * `VACUUM INTO` snapshot of the live database — a single consistent copy regardless of
 * WAL state. Filename timestamps swap `:`/`.` for `-`: colons are illegal on Windows
 * (dev test runs), and lexicographic order stays chronological for pruning.
 */
export async function backupDatabase(
  client: Client,
  opts: { backupsDir: string; appVersion: string; timestamp?: Date },
): Promise<string> {
  mkdirSync(opts.backupsDir, { recursive: true });
  const stamp = (opts.timestamp ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(opts.backupsDir, `pre-migration-${stamp}-v${opts.appVersion}.db`);
  await client.execute({ sql: "VACUUM INTO ?", args: [backupPath] });
  return backupPath;
}

/**
 * Keep the newest `retention` backups by count, delete the rest; returns what was
 * deleted. Count-based so crash-loop retries (each retry re-backs-up while a migration
 * stays pending) rotate within N instead of growing unbounded. Newest-by-name is
 * newest-by-time only because the timestamp prefix is fixed-width (see backupDatabase).
 */
export function pruneBackups(backupsDir: string, retention: number): string[] {
  let names: string[];
  try {
    names = readdirSync(backupsDir);
  } catch {
    return [];
  }
  const backups = names.filter((n) => n.startsWith("pre-migration-") && n.endsWith(".db")).sort();
  const excess = backups.slice(0, Math.max(0, backups.length - retention));
  const deleted = excess.map((name) => path.join(backupsDir, name));
  for (const file of deleted) rmSync(file);
  return deleted;
}

/** Apply every pending migration — one atomic libsql batch, all-or-nothing. */
export async function runMigrations(client: Client, folder = migrationsFolder): Promise<void> {
  await migrate(drizzle(client), { migrationsFolder: folder });
}
