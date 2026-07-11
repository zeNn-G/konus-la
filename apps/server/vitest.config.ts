import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server",
    // `tsc -b` (check-types) emits compiled *.test.js into dist/ — don't run those copies.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
