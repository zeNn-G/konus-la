import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TestProject } from "vitest/node";

import { ALICE, BOB, SERVER_URL, WEB_URL } from "./src/fixtures";

/**
 * Boots the full stack against a throwaway db, then seeds two users (Better Auth HTTP API —
 * Alice is the code-free first signup, Bob consumes a seeded signup code) and one guild with
 * #general + #alerts. Ports are offset from dev (3000/3001 → 3100/3101) so a running dev
 * session never collides.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(here, ".tmp");

const STARTUP_TIMEOUT_MS = 120_000;

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/f", "/t", "/pid", String(child.pid)]);
  } else {
    child.kill("SIGTERM");
  }
}

function pipeToBuffer(child: ChildProcess, sink: string[]): void {
  child.stdout?.on("data", (chunk: Buffer) => sink.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => sink.push(chunk.toString()));
}

async function waitForHttp(url: string, label: string, logs: string[]): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not come up at ${url} within ${STARTUP_TIMEOUT_MS}ms.\n${logs.join("")}`);
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
    throw new Error(`sign-up failed for ${user.email} (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { user: { id: string } };
  return body.user;
}

export default async function globalSetup(project: TestProject) {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const env = {
    ...process.env,
    DATABASE_URL: `file:${path.join(tmpDir, "e2e.db").replace(/\\/g, "/")}`,
    BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-1234",
    BETTER_AUTH_URL: SERVER_URL,
    CORS_ORIGIN: WEB_URL,
    NODE_ENV: "development",
  };

  // Migrate before the server boots. Env must be set before @konus-la/db loads — hence
  // the dynamic imports throughout.
  Object.assign(process.env, env);
  const { applyMigrations, closeTestDb, seedTestMembership } = await import("@konus-la/db/testing");
  await applyMigrations();

  const logs: string[] = [];
  const server = spawn("bun", ["src/index.ts"], {
    cwd: path.resolve(here, "../server"),
    env: { ...env, PORT: "3100" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const web = spawn("bun", ["x", "vite", "dev", "--port", "3101", "--strictPort"], {
    cwd: path.resolve(here, "../web"),
    env: { ...env, VITE_SERVER_URL: SERVER_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeToBuffer(server, logs);
  pipeToBuffer(web, logs);

  try {
    await waitForHttp(`${SERVER_URL}/`, "api server", logs);
    await waitForHttp(`${WEB_URL}/`, "web dev server", logs);

    const alice = await signUp(ALICE); // first user: no code needed, becomes Instance Owner
    const { createCode, createGuildWithOwner, createChannel, listChannelsForViewer } =
      await import("@konus-la/db");
    const code = await createCode({ createdByUserId: alice.id });
    const bob = await signUp(BOB, code.code);

    const guild = await createGuildWithOwner({ name: "E2E Guild", ownerUserId: alice.id });
    await seedTestMembership(guild.id, bob.id);
    const alerts = await createChannel({ guildId: guild.id, name: "alerts" });
    const channels = await listChannelsForViewer(guild.id, alice.id);
    const general = channels.find((channel) => channel.name === "general");
    if (!general) throw new Error("guild seeding did not produce #general");
    closeTestDb();

    project.provide("e2e", { guildId: guild.id, generalId: general.id, alertsId: alerts.id });
  } catch (error) {
    killTree(server);
    killTree(web);
    throw error;
  }

  return () => {
    killTree(server);
    killTree(web);
    try {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // leave it to the next run's cleanup
    }
  };
}
