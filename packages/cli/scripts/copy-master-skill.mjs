#!/usr/bin/env node
/**
 * Pre-build step: copy the canonical master Dopl SKILL.md from
 * `packages/mcp-server/skills/dopl/SKILL.md` into this package's
 * `dist/skills/dopl/SKILL.md` so the published CLI bundle ships with
 * a copy. The CLI's `dopl mcp config --write` reads from there at
 * runtime to drop the skill into `~/.claude/skills/dopl/`.
 *
 * Keeping the master skill in `packages/mcp-server/skills/` means
 * mcp-server is the single source of truth (it's referenced in
 * SERVER_INSTRUCTIONS and the mcp-server package can ship it too if
 * we ever need to). The CLI just snapshots a copy at build time.
 */

import { mkdir, copyFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

const src = join(
  repoRoot,
  "packages",
  "mcp-server",
  "skills",
  "dopl",
  "SKILL.md",
);
const dst = join(__dirname, "..", "dist", "skills", "dopl", "SKILL.md");

try {
  await access(src);
} catch {
  console.error(
    `[cli/build] Master SKILL.md not found at ${src} — the published bundle won't include the skill. Did packages/mcp-server/skills/dopl/SKILL.md get moved or deleted?`,
  );
  process.exit(0); // non-fatal — the CLI builds without the skill
}

await mkdir(dirname(dst), { recursive: true });
await copyFile(src, dst);
console.log(`[cli/build] Copied master skill → ${dst.replace(repoRoot, ".")}`);
