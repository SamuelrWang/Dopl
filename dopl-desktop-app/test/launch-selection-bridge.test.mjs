// THE BRIDGE HALF OF THE LAUNCH SELECTION (U7/U8; the level model since 2026-09-25).
//
// ⚠ SOURCE-ASSERTED BECAUSE THE HOLE IS AT AN END, NOT IN THE MIDDLE. Neither end can drive the
// other in-process: the preload needs `electron`, and the validator is sliced pure. The preload once
// coerced an ABSENT field to `''` on every posture write, and main rejects the WHOLE write on an
// unknown value — so a runtime-only patch was refused with nothing on screen saying why. The two
// ends have to agree or the rule has a hole at whichever one forgets.
//
// Run: `node --test dopl-desktop-app/test/launch-selection-bridge.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, codeOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const requireMain = createRequire(import.meta.url);
const read = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");
const PRELOAD = read("renderer", "app-preload.js");

test("PRELOAD: every launch-posture field is forwarded ONLY when the caller supplied one", () => {
  for (const key of ["level", "messages", "runtime"]) {
    assert.match(PRELOAD, new RegExp(`\\.\\.\\.\\(preset && preset\\.${key} !== undefined \\?`), `\`${key}\` on an own key`);
  }
  // The per-runtime words are derived in main now; the bridge carries none of them.
  assert.ok(!/preset\.(tools|native|model)/.test(codeOf(PRELOAD)));
});

test("PRELOAD: the per-runtime levels cross as a FLAT MAP OF STRINGS and nothing else", () => {
  const body = between(PRELOAD, "const asLevels", "contextBridge.exposeInMainWorld");
  assert.match(body, /out\[String\(id\)\] = asMode\(byRuntime\[id\]\)/);
  assert.ok(!/JSON\.|structuredClone|Object\.assign/.test(body), "nothing structural may cross");
});

test("PRELOAD: the defaults write carries `v`, the level and `byRuntime`, or main reads it as LEGACY", () => {
  assert.match(PRELOAD, /\.\.\.\(defaults && defaults\.v !== undefined \? \{ v: Number\(defaults\.v\) \} : \{\}\)/);
  assert.match(PRELOAD, /level: asMode\(defaults && defaults\.level\)/);
  assert.match(PRELOAD, /byRuntime: asLevels\(defaults\.byRuntime\)/);
  assert.ok(!/defaults\.(tools|model)/.test(codeOf(PRELOAD)));
  assert.match(read("main", "agent-defaults.js"), /const legacy = raw\.v == null;/,
    "…and main's branch is the reason the key has to be there");
});

test("MAIN: a runtime-only patch claims nothing about the level, and keeps it", () => {
  const selection = requireMain("../main/launch-selection");
  const ctx = requireMain("../main/runtime").selectionContext();
  const base = selection.patchSelection(ctx, selection.emptySelection(ctx), { level: "auto" }).selection;
  assert.deepEqual(selection.patchRejections(ctx, base, { runtime: "codex" }), []);
  assert.equal(selection.patchRejections(ctx, base, { level: "", messages: "" }).length, 2,
    "…and the shape an absent-to-'' coercion would produce is refused on BOTH axes");
  assert.equal(selection.patchSelection(ctx, base, { runtime: "codex" }).selection.level, "auto");
});
