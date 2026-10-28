import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "vitest.server-only-shim.ts"),
      // In-repo consumers read the device contracts from SOURCE (same as tsconfig `paths`, which
      // Next also honours); the package's own `exports` point at its built `dist/` for publishing.
      "@dopl/device-contracts": path.resolve(__dirname, "packages/device-contracts/src/index.ts"),
      // The display seam (W1.2) calls the Dopl App's own API through the SDK client, read from SOURCE too.
      "@dopl/sdk": path.resolve(__dirname, "packages/sdk/src/index.ts"),
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
