// Evaluates a `main/` module from source with every `require` answered from a stub map, so a test
// drives the real code over fakes. An unlisted require throws: a new dependency is faked on purpose.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "main");
const requireMain = createRequire(join(MAIN, "index.js"));

/** The real module, loaded normally (for stub maps that keep a dependency real). */
export const real = (id) => requireMain(id);

/** CommonJS `src` evaluated with `require` as given. Returns its exports. */
export function evalModule(src, require) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", src)(require, mod, mod.exports);
  return mod.exports;
}

/** `main/<file>` with `stubs` (`{ "./id": exports }`) as its only requires. */
export function loadWithStubs(file, stubs) {
  return evalModule(readFileSync(join(MAIN, file), "utf8"), (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`unexpected require: ${id}`);
  });
}
