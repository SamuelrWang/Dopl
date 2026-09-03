/**
 * WHICH FILES MAKE UP ONE TOOL — the auto-discovering source scan the invariant
 * suites share. ⚠ Test-only; nothing in the server imports it.
 *
 * A tool is a REGISTRAR plus its `<stem>-*.ts` siblings, and every suite that
 * greps "the tool's source" must read the WHOLE set — a hardcoded file list
 * silently drops the next module split out of coverage.
 *
 * ⚠ THE `<stem>-` FILENAME PREFIX IS THE CONTRACT: a handler, schema fragment
 * or description string in an unprefixed file is invisible to every scan.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * ⚠ Paths relative to the package root (vitest cwd): `import.meta` is
 * disallowed by the CommonJS tsc target and `__dirname` is not guaranteed under
 * the ESM-transformed test.
 */
export const TOOLS_DIR = path.resolve(process.cwd(), "src", "tools");

/**
 * ⚠ **THE META TOOLS REGISTER FROM `src/`, NOT `src/tools/`** — they go on the
 * SDK server directly rather than through `registerTool`'s wrapper
 * (`registrar.ts`), so they sit a layer up with it. Every scan here is
 * basename-keyed, so the directory is resolved rather than assumed: a hardcoded
 * `src/tools` silently returned an EMPTY source for `meta-tools.ts`, which made
 * the described-but-dead-param scan pass over it by finding nothing (2026-09-02,
 * F-621 — the first meta tool with a param since B13).
 */
function dirFor(file: string): string {
  return existsSync(path.join(TOOLS_DIR, file))
    ? TOOLS_DIR
    : path.resolve(process.cwd(), "src");
}

/** One tool-source file, read from disk. */
export function sourceOf(file: string): string {
  return readFileSync(path.join(dirFor(file), file), "utf8");
}

/**
 * A registrar plus every `<stem>-*.ts` sibling, discovered from disk (tests
 * excluded) so the next split is covered without editing here.
 */
export function toolGroupFiles(registrarFile: string): string[] {
  const stem = registrarFile.replace(/\.ts$/, "");
  return readdirSync(dirFor(registrarFile)).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      (f === registrarFile || f.startsWith(`${stem}-`)),
  );
}

/** Concatenated source of a registrar plus its split-out sibling modules. */
export function toolGroupSource(registrarFile: string): string {
  return toolGroupFiles(registrarFile).map(sourceOf).join("\n");
}
