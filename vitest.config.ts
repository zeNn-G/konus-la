import { defineConfig } from "vitest/config";

// Local DX only: `bun x vitest` runs every unit suite in one go. CI and caching go through
// `turbo test` (per-package tasks), which never reads this file. The e2e app is excluded on
// purpose — it boots servers and browsers (`bun run test:e2e`).
export default defineConfig({
  test: {
    projects: ["packages/db", "packages/api"],
  },
});
