import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createStaticHandler } from "./static";

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

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "konus-static-"));
  dirs.push(dir);
  return dir;
}

/** Writes a minimal Vite-shaped dist/ (index.html + hashed assets) and returns its path. */
function builtDist(): string {
  const dist = path.join(tempDir(), "dist");
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>konus</title>");
  writeFileSync(path.join(dist, "assets", "index-Ck2a9x.js"), "console.log('app')");
  writeFileSync(path.join(dist, "assets", "index-B1c4Qd.css"), "body{margin:0}");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg></svg>");
  return dist;
}

function get(handler: ReturnType<typeof createStaticHandler>, pathname: string, method = "GET") {
  const url = new URL(pathname, "http://localhost:3000");
  return handler(new Request(url.toString(), { method }), url);
}

describe("createStaticHandler", () => {
  test("falls through when dist/ is absent (dev)", async () => {
    const handler = createStaticHandler(path.join(tempDir(), "dist"));

    expect(await get(handler, "/")).toBeNull();
    expect(await get(handler, "/g/1/c/2")).toBeNull();
  });

  test("serves index.html at / with no-cache", async () => {
    const handler = createStaticHandler(builtDist());

    const response = await get(handler, "/");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toContain("text/html");
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response?.text()).toContain("konus");
  });

  test("serves content-hashed /assets/* as immutable", async () => {
    const handler = createStaticHandler(builtDist());

    const js = await get(handler, "/assets/index-Ck2a9x.js");
    expect(js?.status).toBe(200);
    expect(js?.headers.get("Content-Type")).toContain("text/javascript");
    expect(js?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await js?.text()).toBe("console.log('app')");

    const css = await get(handler, "/assets/index-B1c4Qd.css");
    expect(css?.headers.get("Content-Type")).toContain("text/css");
    expect(css?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  test("serves non-hashed root files with no-cache", async () => {
    const handler = createStaticHandler(builtDist());

    const response = await get(handler, "/favicon.svg");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
  });

  test("falls back to index.html for router deep links", async () => {
    const handler = createStaticHandler(builtDist());

    const response = await get(handler, "/g/abc123/c/def456");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toContain("text/html");
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response?.text()).toContain("konus");
  });

  test("only handles GET", async () => {
    const handler = createStaticHandler(builtDist());

    expect(await get(handler, "/g/abc/c/def", "POST")).toBeNull();
    expect(await get(handler, "/", "DELETE")).toBeNull();
  });

  test("never serves files outside dist/", async () => {
    const dist = builtDist();
    writeFileSync(path.join(dist, "..", "secret.txt"), "top secret");
    const handler = createStaticHandler(dist);

    for (const attempt of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]) {
      const url = new URL(`http://localhost:3000${attempt}`);
      const response = await handler(new Request("http://localhost:3000/", { method: "GET" }), url);
      expect(await response?.text()).not.toContain("top secret");
    }
  });
});
