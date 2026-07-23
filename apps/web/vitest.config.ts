import path from "node:path";

import { defineConfig } from "vitest/config";

// Tests read import.meta.env (via @konus-la/env/web), which Vite resolves at config
// time from .env files + VITE_-prefixed process.env — vitest's `test.env` lands too
// late for it. Without a value (CI has no .env), server-url.ts falls back to
// window.location.origin at import time and crashes the node test environment.
process.env.VITE_SERVER_URL ??= "http://localhost:3000";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    name: "web",
    // Pure-logic tests only (voice session machine, cache reducers) — anything DOM- or
    // socket-shaped is injected, so no jsdom/browser environment is needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
