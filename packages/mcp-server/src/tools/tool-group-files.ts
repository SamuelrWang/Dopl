/**
 * WHICH FILES MAKE UP ONE TOOL — the auto-discovering source scan the invariant
 * suites share. Test-only, like `narration-fixtures.ts`; nothing in the server
 * imports it.
 *
 * A tool is a REGISTRAR plus its split-out siblings (`channel.ts` +
 * `channel-*.ts`, `ontology.ts` + `ontology-*.ts`, …), and every suite that
 * greps "the tool's source" has to read the whole set or a §2 split silently
 * drops it out of coverage. That already happened: `channel-deadlines.test.ts`
 * hardcoded a three-file list for the await-cap scan, so a fourth file
 * retyping the cap would have passed. `parity.test.ts` had the auto-discovering
 * version; this is that function, moved to one place so both read it.
 *
 * THE `channel-` (or `<stem>-`) FILENAME PREFIX IS THE CONTRACT. A handler,
 * schema fragment or description string in an unprefixed file is invisible to
 * every scan below it — see the note in `channel.ts`'s header.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Vitest runs with cwd = the package root (this package's vitest.config.ts), so
 * sources are addressed relative to it. This avoids both `import.meta`
 * (disallowed by the package's CommonJS tsc target) and `__dirname` (not
 * guaranteed under the ESM-transformed test).
 */
export const TOOLS_DIR = path.resolve(process.cwd(), "src", "tools");

/** One tool-source file, read from disk. */
export function sourceOf(file: string): string {
  return readFileSync(path.join(TOOLS_DIR, file), "utf8");
}

/**
 * A registrar plus every `<stem>-*.ts` sibling it was split into, discovered
 * from disk (tests excluded) so the next split is covered without editing here.
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
