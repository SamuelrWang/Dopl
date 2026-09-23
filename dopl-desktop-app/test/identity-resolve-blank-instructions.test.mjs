import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { applyOverrides, narrowOverrides } = require("../main/template-resolve.js");

// F-695 RULED 2026-09-13: "blank template instructions should just not have any pre filled
// instructions … it just has an empty field" — and what is TYPED into it is carried.
test("a blank launch with typed instructions runs as an instructions-only template", () => {
  const t = applyOverrides(null, narrowOverrides({ instructions: "Answer in one line." }));
  assert.equal(t.instructionsOnly, true);
  assert.equal(t.name, null);
  assert.equal(t.instructions, "Answer in one line.");
  assert.equal(t.authoredByCaller, true, "the operator wrote it — own header, no approval gate");
});

test("a blank launch with nothing typed is still no template", () => {
  assert.equal(applyOverrides(null, narrowOverrides({})), null);
  assert.equal(applyOverrides(null, narrowOverrides({ instructions: "   " })), null);
});
