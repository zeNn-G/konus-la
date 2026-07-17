// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Standalone boot for driving the
// user-settings prototype: e2e global-setup minus vitest — scratch db, both servers,
// alice + bob + one guild. Ctrl-C to tear down. Never committed.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALICE, BOB, SERVER_URL, WEB_URL } from "./src/fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, ".tmp-proto");

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/f", "/t", "/pid", String(child.pid)]);
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

async function signUp(
  user: { email: string; password: string; name: string; username: string },
  signupCode?: string,
): Promise<{ id: string }> {
  const response = await fetch(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signupCode ? { "x-signup-code": signupCode } : {}),
    },
    body: JSON.stringify(user),
  });
  if (!response.ok) {
    throw new Error(`sign-up failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { user: { id: string } };
  return body.user;
}

rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const env = {
  ...process.env,
  DATABASE_URL: `file:${path.join(tmpDir, "proto.db").replace(/\\/g, "/")}`,
  BETTER_AUTH_SECRET: "proto-only-secret-proto-only-secret1",
  BETTER_AUTH_URL: SERVER_URL,
  CORS_ORIGIN: WEB_URL,
  NODE_ENV: "development",
};

Object.assign(process.env, env);
const { applyMigrations, closeTestDb, seedTestMembership } = await import("@konus-la/db/testing");
await applyMigrations();

const server = spawn("bun", ["src/index.ts"], {
  cwd: path.resolve(here, "../server"),
  env: { ...env, PORT: "3100" },
  stdio: ["ignore", "inherit", "inherit"],
});
const web = spawn("bun", ["x", "vite", "dev", "--port", "3101", "--strictPort"], {
  cwd: path.resolve(here, "../web"),
  env: { ...env, VITE_SERVER_URL: SERVER_URL },
  stdio: ["ignore", "inherit", "inherit"],
});

process.on("SIGINT", () => {
  killTree(server);
  killTree(web);
  process.exit(0);
});

await waitForHttp(`${SERVER_URL}/`, "api server");
await waitForHttp(`${WEB_URL}/`, "web dev server");

const alice = await signUp(ALICE);
const { createCode, createGuildWithOwner, createChannel } = await import("@konus-la/db");
const code = await createCode({ createdByUserId: alice.id });
const bob = await signUp(BOB, code.code);

const guild = await createGuildWithOwner({ name: "Proto Guild", ownerUserId: alice.id });
await seedTestMembership(guild.id, bob.id);
await createChannel({ guildId: guild.id, name: "lounge", kind: "voice" });
closeTestDb();

console.log(`\nPROTO READY web=${WEB_URL} guild=${guild.id} alice=${ALICE.email}\n`);
