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
  },
});
