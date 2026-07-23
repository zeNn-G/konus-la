import path from "node:path";

import { defineConfig } from "vitest/config";

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
    // Set BEFORE dotenv runs (same pattern as packages/api): with VITE_SERVER_URL
    // unset, server-url.ts falls back to window.location.origin at import time, which
    // doesn't exist in the node environment. Pinning it also keeps a developer's .env
    // out of tests.
    env: {
      VITE_SERVER_URL: "http://localhost:3000",
    },
  },
});
