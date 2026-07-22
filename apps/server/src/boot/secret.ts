import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SecretSource = "env" | "file" | "generated";

/**
 * Resolve `BETTER_AUTH_SECRET` before the env module validates it: env wins, else the
 * persisted file, else generate 32 crypto-random bytes and persist them `0600` so the
 * same secret survives restarts. A too-short file (partial write) fails env validation
 * on every retry, so it is regenerated rather than crash-looping the boot.
 */
export function ensureAuthSecret(opts: {
  env: Record<string, string | undefined>;
  secretPath: string;
}): SecretSource {
  const { env, secretPath } = opts;
  if (env.BETTER_AUTH_SECRET) return "env";

  if (existsSync(secretPath)) {
    const persisted = readFileSync(secretPath, "utf8").trim();
    if (persisted.length >= 32) {
      env.BETTER_AUTH_SECRET = persisted;
      return "file";
    }
  }

  const secret = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, secret, { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  env.BETTER_AUTH_SECRET = secret;
  return "generated";
}
