import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    setupFiles: ["./vitest.setup.ts"],
    // Set BEFORE dotenv runs, so a developer's .env can't leak into tests (dotenv never
    // overrides existing vars). DATABASE_URL is set in vitest.setup.ts — a unique temp
    // file per test file.
    env: {
      BETTER_AUTH_SECRET: "vitest-only-secret-vitest-only-secret",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:3001",
      NODE_ENV: "test",
    },
  },
});
