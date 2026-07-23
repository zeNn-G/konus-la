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

    // Raw `..` never reaches the handler (URL parsing normalizes dot segments), so the
    // live vectors are the encoded ones that survive parsing and decode inside.
    for (const attempt of ["/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%5csecret.txt"]) {
      const response = await get(handler, attempt);
      expect(await response?.text()).not.toContain("top secret");
    }
  });

  test("serves the fallback for malformed percent-encoding instead of throwing", async () => {
    const handler = createStaticHandler(builtDist());

    for (const attempt of ["/%c0", "/%"]) {
      const response = await get(handler, attempt);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toContain("text/html");
    }
  });

  test("keys the immutable header on the resolved file, not the raw path", async () => {
    const handler = createStaticHandler(builtDist());

    // %2e%2e dot segments die in URL parsing, but %5c survives it and decodes to a
    // backslash — which path.resolve on Windows walks: /assets/..\favicon.svg resolves
    // to the non-hashed root file. On POSIX the backslash is a literal filename char,
    // so the miss serves the fallback instead. Either way the resolved file is outside
    // assets/, so the raw /assets/ prefix must never earn the immutable header.
    const response = await get(handler, "/assets/..%5cfavicon.svg");

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe(
      process.platform === "win32" ? "image/svg+xml" : "text/html; charset=utf-8",
    );
    expect(response?.headers.get("Cache-Control")).toBe("no-cache");
  });
});
