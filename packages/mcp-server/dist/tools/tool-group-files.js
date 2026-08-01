"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS_DIR = void 0;
exports.sourceOf = sourceOf;
exports.toolGroupFiles = toolGroupFiles;
exports.toolGroupSource = toolGroupSource;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/**
 * Vitest runs with cwd = the package root (this package's vitest.config.ts), so
 * sources are addressed relative to it. This avoids both `import.meta`
 * (disallowed by the package's CommonJS tsc target) and `__dirname` (not
 * guaranteed under the ESM-transformed test).
 */
exports.TOOLS_DIR = node_path_1.default.resolve(process.cwd(), "src", "tools");
/** One tool-source file, read from disk. */
function sourceOf(file) {
    return (0, node_fs_1.readFileSync)(node_path_1.default.join(exports.TOOLS_DIR, file), "utf8");
}
/**
 * A registrar plus every `<stem>-*.ts` sibling it was split into, discovered
 * from disk (tests excluded) so the next split is covered without editing here.
 */
function toolGroupFiles(registrarFile) {
    const stem = registrarFile.replace(/\.ts$/, "");
    return (0, node_fs_1.readdirSync)(exports.TOOLS_DIR).filter((f) => f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        (f === registrarFile || f.startsWith(`${stem}-`)));
}
/** Concatenated source of a registrar plus its split-out sibling modules. */
function toolGroupSource(registrarFile) {
    return toolGroupFiles(registrarFile).map(sourceOf).join("\n");
}
