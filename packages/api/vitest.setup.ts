import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, vi } from "vitest";

// A throwaway FILE db per test file, set before anything imports @konus-la/env or /db
// (hence the dynamic import below). `:memory:` cannot work: @libsql/client's sqlite3
// flavor gives its live connection away to every interactive transaction and lazily opens
// a NEW — empty — memory db for the next statement. A file keeps every connection pointed
// at the same database.
const tempDir = mkdtempSync(path.join(os.tmpdir(), "konus-vitest-"));
process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db").replace(/\\/g, "/")}`;

// Better Auth is the ONLY thing mocked: `x-test-user: <id>` on the request headers
// authenticates as that user, whose row is read from the same test db the routers hit.
// Middlewares, routers, and queries all run for real. (`getSession` is what `requireAuth`
// in src/index.ts calls; nothing else on the auth surface is touched by procedures.)
vi.mock("@konus-la/auth", () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user");
        if (!userId) return null;
        const { getTestUser } = await import("@konus-la/db/testing");
        const row = await getTestUser(userId);
        if (!row) return null;
        return {
          session: {
            id: `session-${userId}`,
            userId,
            token: `token-${userId}`,
            expiresAt: new Date(Date.now() + 3_600_000),
            createdAt: new Date(),
            updatedAt: new Date(),
            ipAddress: null,
            userAgent: null,
            impersonatedBy: null,
          },
          user: row,
        };
      },
    },
  },
}));

const { applyMigrations, closeTestDb } = await import("@konus-la/db/testing");
await applyMigrations();

afterAll(() => {
  // Best-effort: transaction connections can outlive closeTestDb() on Windows, and a
  // leftover temp file must not fail the suite.
  try {
    closeTestDb();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // leave it to OS temp cleanup
  }
});
