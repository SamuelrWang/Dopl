// A `''` RUNTIME KEY IS THE DEFAULT RUNTIME, AND IT IS READ (P3-05). A surface that keyed a write by
// the unpicked runtime stored `byRuntime['']`, which main carried as an unregistered id and never
// read: the Settings row snapped back and new channels seeded nothing from it.
//
// Run: `node --test dopl-desktop-app/test/launch-selection-default-key.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const selection = require(join(MAIN, "launch-selection.js"));
const registry = require(join(MAIN, "runtime", "index.js"));

test("P3-05: a record written under byRuntime[''] folds into the default runtime and is READ", () => {
  const ctx = registry.selectionContext();
  const got = selection.normalizeSelection(ctx, { v: 2, runtime: "", messages: "ask", byRuntime: { "": { tools: "bypass" } } });
  assert.deepEqual(got.selection.byRuntime, { claude: { tools: "bypass" } });
  assert.equal(selection.toLegacyPosture(ctx, got.selection).tools, "bypass");
  const both = selection.normalizeSelection(ctx, {
    v: 2, runtime: "", messages: "ask", byRuntime: { claude: { tools: "manual" }, "": { tools: "auto" } },
  });
  assert.deepEqual(both.selection.byRuntime, { claude: { tools: "auto" } }, "the '' write is the newer one");
  const seed = selection.patchSelection(ctx, selection.emptySelection(), { byRuntime: { "": { tools: "auto" } } });
  assert.ok(!Object.prototype.hasOwnProperty.call(seed.selection.byRuntime, ""), "never carried as an unread key");
});
