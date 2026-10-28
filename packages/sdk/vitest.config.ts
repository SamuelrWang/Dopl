import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The SDK suite (mocked fetch, no network). The root config collects `src/**` only, so this package
 * runs its own. `@dopl/device-contracts` resolves to its SOURCE here (as in `tsconfig.json › paths`)
 * so tests need no prior build; the published build (`tsconfig.build.json`) resolves its `dist/`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@dopl/device-contracts": fileURLToPath(new URL("../device-contracts/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: process.env.CI ? undefined : 2,
  },
});
