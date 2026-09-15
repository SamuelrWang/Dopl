// A MAILBOX BINDER THAT IS DEFINED BUT NOT EXPORTED IS A LANE THAT NEVER ARMS, AND THE ONLY
// REPORT IS ONE SWALLOWED DIAG LINE AT BOOT (2026-09-14).
//
// WHAT WAS MEASURED. Every run in `~/Library/Application Support/dopl-desktop/listener.log`
// carries, one millisecond after `realtime directives ARMED — rejoining`:
//
//     agent-directions: realtime arm failed — realtime.setDirections is not a function
//     agent-directions: armed — lane off (default)
//
// `realtime.js` DEFINES `setDirections` (beside `setDirectives`, same shape, same `rejoinAll`
// injection) and its `module.exports` block simply never named it. `agent-directions.js ›
// refresh` is the sole caller and wraps the call in a try/catch that logs and swallows — the
// header there calls itself "the ONLY thing that touches realtime" — so the PRIVATE DIRECT LANE
// has never bound its `channel_agent_directions` mailbox on the realtime socket for ANY operator,
// including one who had opted in. It silently fell back to the 60s poll, and the second line
// above made the failure read like an operator who had not turned the lane on.
//
// WHY THIS IS A SEPARATE SUITE FROM `main-exports-defined.test.mjs`. That gate walks the
// `module.exports` object and asserts every NAME IN IT IS BOUND in the file. This is the opposite
// direction — a binder that is bound and never exported — and no amount of strengthening the
// other gate reaches it: "every top-level const must be exported" is false for almost every
// module in `main/`. The tractable form of the question is the one below: for the mailbox
// binders specifically, the module must export exactly what its callers name.
//
// ⚠ IT READS SOURCE, NOT A LOADED MODULE. `realtime.js` requires electron transitively, so this
// suite cannot `require` it; and the CALLER's expectation is a source fact anyway
// (`realtime.<name>(`), which is precisely what drifted.
//
// Run: `node --test dopl-desktop-app/test/realtime-mailbox-exports.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const RT_SRC = readFileSync(join(MAIN, "realtime.js"), "utf8");

/** The `module.exports = { … }` literal of `realtime.js`. */
function exportsBlock(src) {
  const from = src.indexOf("\nmodule.exports = {");
  assert.notEqual(from, -1, "realtime.js no longer exports an object literal");
  const to = src.indexOf("\n};", from);
  assert.ok(to > from, "unterminated module.exports block");
  return src.slice(from, to);
}

/** Comments blanked, so a name that only appears in prose is never read as code. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

const EXPORTED = new Set(
  [...code(exportsBlock(RT_SRC)).matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[,:]/gm)].map((m) => m[1])
);

test("🔒 every `realtime.<name>(…)` a main module calls is actually exported", () => {
  const missing = [];
  for (const file of readdirSync(MAIN)) {
    if (!file.endsWith(".js") || file === "realtime.js") continue;
    const src = readFileSync(join(MAIN, file), "utf8");
    // Only files that bind the module under the name `realtime` are asking this question.
    if (!/\brequire\(['"]\.\/realtime['"]\)/.test(src)) continue;
    for (const m of code(src).matchAll(/\brealtime\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!EXPORTED.has(m[1])) missing.push(`${file} calls realtime.${m[1]}()`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    // The incident's own line, so the next reader does not have to go and find it.
    "a caller names a realtime export that does not exist — this is the shape that logged " +
      "`agent-directions: realtime arm failed — realtime.setDirections is not a function` " +
      "on every boot and turned the private direct lane off in silence"
  );
});

/**
 * 🔒 THE TWO MAILBOX BINDERS TRAVEL TOGETHER.
 *
 * `setDirectives` (the LAUNCH mailbox) and `setDirections` (the PRIVATE DIRECT mailbox) are the
 * same construction — a thin `const` over `realtime-mailboxes.js` with `rejoinAll` injected —
 * and the whole defect was that only one of them reached the exports block. Naming both here
 * makes the pair the unit, so the next binder added beside them either joins this list or fails
 * the case above by way of its caller.
 */
test("🔒 both mailbox binders are defined AND exported", () => {
  for (const name of ["setDirectives", "setDirections"]) {
    assert.match(
      code(RT_SRC),
      new RegExp(`const\\s+${name}\\s*=`),
      `${name} is no longer defined in realtime.js`
    );
    assert.ok(EXPORTED.has(name), `${name} is defined in realtime.js but not exported`);
  }
});

/** And the mailbox module it delegates to still offers both — the other half of the pair. */
test("realtime-mailboxes.js still exports the two binders realtime.js wraps", () => {
  const src = code(readFileSync(join(MAIN, "realtime-mailboxes.js"), "utf8"));
  for (const name of ["setDirectives", "setDirections"]) {
    assert.match(src, new RegExp(`module\\.exports\\s*=\\s*\\{[^}]*\\b${name}\\b`));
  }
});
