import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { ensureAuthSecret } from "./secret";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

function tempSecretPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "konus-secret-"));
  dirs.push(dir);
  return path.join(dir, ".auth-secret");
}

describe("ensureAuthSecret", () => {
  test("an env-provided secret wins and no file is written", () => {
    const secretPath = tempSecretPath();
    const env = { BETTER_AUTH_SECRET: "from-env-secret-from-env-secret-abc" };

    expect(ensureAuthSecret({ env, secretPath })).toBe("env");
    expect(env.BETTER_AUTH_SECRET).toBe("from-env-secret-from-env-secret-abc");
    expect(() => statSync(secretPath)).toThrow();
  });

  test("no env and no file generates, persists (0600), and injects a secret", () => {
    const secretPath = tempSecretPath();
    const env: Record<string, string | undefined> = {};

    expect(ensureAuthSecret({ env, secretPath })).toBe("generated");
    expect(env.BETTER_AUTH_SECRET).toBeDefined();
    expect((env.BETTER_AUTH_SECRET as string).length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(secretPath, "utf8")).toBe(env.BETTER_AUTH_SECRET);
    if (process.platform !== "win32") {
      expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    }
  });

  test("a persisted secret is reused across restarts", () => {
    const secretPath = tempSecretPath();
    const first: Record<string, string | undefined> = {};
    ensureAuthSecret({ env: first, secretPath });

    const second: Record<string, string | undefined> = {};
    expect(ensureAuthSecret({ env: second, secretPath })).toBe("file");
    expect(second.BETTER_AUTH_SECRET).toBe(first.BETTER_AUTH_SECRET);
  });

  test("a corrupt (too-short) secret file is regenerated instead of crash-looping", () => {
    const secretPath = tempSecretPath();
    writeFileSync(secretPath, "truncated");

    const env: Record<string, string | undefined> = {};
    expect(ensureAuthSecret({ env, secretPath })).toBe("generated");
    expect((env.BETTER_AUTH_SECRET as string).length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(secretPath, "utf8")).toBe(env.BETTER_AUTH_SECRET);
  });
});
