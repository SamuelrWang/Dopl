// The identity's runtime crosses the resolve boundary as a grammar-checked id, `''` for none (C4).
// The launch-runtime order (pick → identity → channel) reads it; this file pins only the narrow.
//
// Run: `node --test dopl-desktop-app/test/identity-resolve-runtime.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { narrow } = require("../main/identity-resolve.js");

test("a registered-shape runtime id is kept", () => {
  assert.equal(narrow({ name: "Coder", runtime: "codex" }).runtime, "codex");
  assert.equal(narrow({ name: "Coder", runtime: " claude " }).runtime, "claude");
});

test("no runtime, null, or a value outside the id grammar is '' (no preference)", () => {
  for (const runtime of [undefined, null, "", "Codex", "claude code", 7, {}, "x".repeat(40)]) {
    assert.equal(narrow({ name: "Coder", runtime }).runtime, "", JSON.stringify(runtime ?? null));
  }
});
