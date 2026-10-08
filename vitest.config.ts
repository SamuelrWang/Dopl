import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "vitest.server-only-shim.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // Local runs are capped: every agent runs vitest, and the default (one fork per core) swamped the machine.
    // CI keeps the default.
    maxWorkers: process.env.CI ? undefined : 2,
  },
});
