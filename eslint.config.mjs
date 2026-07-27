import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "packages/*/dist/**",
    // Claude Code worktrees contain transpiled package output that must
    // never be linted — they add thousands of bogus errors otherwise.
    "**/.claude/**",
    // CommonJS trees with their OWN eslint configs. The root Next flat config
    // has no CommonJS override, so it (wrongly) flags their `require()` calls as
    // no-require-imports. The desktop app ships dopl-desktop-app/eslint.config.js
    // (authoritative — run `cd dopl-desktop-app && npx eslint main/`); the
    // scripts/ tree is Node CLI tooling. Neither belongs to the Next app lint.
    "dopl-desktop-app/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
