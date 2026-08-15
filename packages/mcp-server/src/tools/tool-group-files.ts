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

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * ⚠ Paths relative to the package root (vitest cwd): `import.meta` is
 * disallowed by the CommonJS tsc target and `__dirname` is not guaranteed under
 * the ESM-transformed test.
 */
export const TOOLS_DIR = path.resolve(process.cwd(), "src", "tools");

/** One tool-source file, read from disk. */
export function sourceOf(file: string): string {
  return readFileSync(path.join(TOOLS_DIR, file), "utf8");
}

/**
 * A registrar plus every `<stem>-*.ts` sibling, discovered from disk (tests
 * excluded) so the next split is covered without editing here.
 */
export function toolGroupFiles(registrarFile: string): string[] {
  const stem = registrarFile.replace(/\.ts$/, "");
  return readdirSync(TOOLS_DIR).filter(
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
