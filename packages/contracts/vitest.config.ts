import { defineConfig } from "vitest/config";

/** The device-sdk schema tests. The root config collects `src/**` only, so this package runs its own. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    maxWorkers: process.env.CI ? undefined : 2,
  },
});
