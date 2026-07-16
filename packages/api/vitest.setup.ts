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
// in src/index.ts calls; `banUser`/`unbanUser` mirror the admin plugin's documented
// semantics — caller session must be an instance admin, ban columns written on the user
// row, the "No reason" default — minus session revocation, which has no fake to revoke.)
vi.mock("@konus-la/auth", async () => {
  const { APIError } = await import("@konus-la/auth/api-error");

  // The admin plugin refuses callers whose session lacks the admin role; the fakes gate the
  // same way so a router that forgot to pass the caller's headers fails loudly in tests.
  async function requireAdminCaller(headers: Headers) {
    const callerId = headers.get("x-test-user");
    const { getTestUser } = await import("@konus-la/db/testing");
    const caller = callerId ? await getTestUser(callerId) : null;
    if (caller?.role !== "admin") {
      throw new APIError("FORBIDDEN", { message: "You are not allowed to ban users" });
    }
  }

  return {
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
        banUser: async ({
          body,
          headers,
        }: {
          body: { userId: string; banReason?: string };
          headers: Headers;
        }) => {
          await requireAdminCaller(headers);
          const { getTestUser, setTestUserBan } = await import("@konus-la/db/testing");
          if (!(await getTestUser(body.userId))) {
            throw new APIError("BAD_REQUEST", { message: "User not found" });
          }
          await setTestUserBan(body.userId, {
            banned: true,
            banReason: body.banReason ?? "No reason",
          });
        },
        unbanUser: async ({ body, headers }: { body: { userId: string }; headers: Headers }) => {
          await requireAdminCaller(headers);
          const { setTestUserBan } = await import("@konus-la/db/testing");
          await setTestUserBan(body.userId, { banned: false, banReason: null });
        },
      },
    },
  };
});

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
