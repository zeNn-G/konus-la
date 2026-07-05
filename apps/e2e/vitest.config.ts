import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./global-setup.ts"],
    // Browser + realtime flows: generous per-test budget, one file at a time (the whole
    // suite shares the two spawned servers and one seeded db).
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
