// WHAT THE OPERATOR CALLS ONE AGENT (2026-08-25, Samuel's rename ruling).
//
// ⚠ WHAT THIS FILE IS ABOUT IS THE REFUSAL, NOT THE HAPPY PATH. The name is typed by a human
// and rendered into a card, a pill and a panel header, so the interesting cases are the ones
// that must NOT be stored: a bidi override renders a card that reads backwards, a zero-width
// joiner makes two different agents look identically named, and a control character carries a
// line break into a rendered result. `sanitizeName` REFUSES those rather than stripping them —
// stripping stores something other than what was typed and says nothing about it.
//
// ⚠ AND THE BOUND ON THE SET. The key is the INSTANCE address, so every launch mints a new one
// and a busy machine accumulates an entry per agent it ever ran. A time bound does not apply (a
// name has no expiry the way an ended run does), so the count IS the whole bound and the sweep
// drops the oldest.
//
// SOURCE EXTRACTION: `agent-names.js` requires `electron-store` at module scope, so its pure
// block is sliced and evaluated on its own — the same bargain `agent-retention.test.mjs` makes
// with `agent-history.js`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "agent-names.js"), "utf8");
const BLOCK = SRC.slice(
  SRC.indexOf("// ─── BEGIN AGENT-NAMES-PURE"),
  SRC.indexOf("// ─── END AGENT-NAMES-PURE")
);

// The purity assertion IS a test: a require here would end the extraction that lets these cases
// drive the real code, and this block decides what reaches the disk.
for (const banned of ["require(", "electron", "child_process", "fetch("]) {
  assert.ok(!BLOCK.includes(banned), `AGENT-NAMES-PURE must not reference ${banned}`);
}

const pure = new Function(`${BLOCK}\nreturn { MAX_NAME, MAX_NAMES, sanitizeName, sweepable, nameFrom };`)();

test("it takes an ordinary name, trimmed and whitespace-collapsed", () => {
  assert.equal(pure.sanitizeName("  Research   bot "), "Research bot");
  assert.equal(pure.sanitizeName("Q3"), "Q3");
  // Capitals, spaces and punctuation are all fine — this is a DISPLAY string, not the handle
  // `channel_sessions.name` accepts.
  assert.equal(pure.sanitizeName("Sam's #2 — reviewer"), "Sam's #2 — reviewer");
});

test("it refuses the invisibles rather than stripping them", () => {
  // ⚠ EACH OF THESE IS A RENDERING ATTACK, not a typo. Silently stripping would store a name
  // the operator did not type and report success.
  // ⚠ ESCAPES, NOT LITERALS: writing these characters into this file would make the fixtures
  // invisible in every diff and review that follows.
  for (const [label, value] of [
    ["a control character", "Research\u0007bot"],
    ["a line break", "Research\nbot"],
    ["a zero-width joiner", "Research\u200dbot"],
    ["a bidi override", "Research\u202ebot"],
    ["a line separator", "Research\u2028bot"],
    ["a BOM", "Research\ufeffbot"],
  ]) {
    assert.equal(pure.sanitizeName(value), null, `${label} must be refused`);
  }
});

test("it refuses nothing-at-all and anything past the bound", () => {
  assert.equal(pure.sanitizeName(""), null);
  assert.equal(pure.sanitizeName("   "), null);
  assert.equal(pure.sanitizeName(null), null);
  assert.equal(pure.sanitizeName(42), null);
  assert.equal(pure.sanitizeName("x".repeat(pure.MAX_NAME)), "x".repeat(pure.MAX_NAME));
  assert.equal(pure.sanitizeName("x".repeat(pure.MAX_NAME + 1)), null);
});

test("a name that was never set reads null, never a blank", () => {
  // ⚠ NULL IS THE ORDINARY ANSWER: most agents are never renamed, and the caller falls back to
  // the canonical `Agent #<id>` (INVARIANTS §11 — UNKNOWN is not EMPTY).
  assert.equal(pure.nameFrom({}, "a1b2c3d4"), null);
  assert.equal(pure.nameFrom({ a1b2c3d4: { name: "" } }, "a1b2c3d4"), null);
  assert.equal(pure.nameFrom(null, "a1b2c3d4"), null);
  assert.equal(pure.nameFrom({ a1b2c3d4: { name: "Research" } }, "a1b2c3d4"), "Research");
  assert.equal(pure.nameFrom({ a1b2c3d4: { name: "Research" } }, ""), null);
});

test("the set is bounded by COUNT, and the sweep drops the oldest first", () => {
  const map = {};
  for (let i = 0; i < pure.MAX_NAMES + 3; i += 1) map[`id${i}`] = { name: `n${i}`, at: i };
  const dropped = pure.sweepable(map);
  assert.deepEqual(dropped, ["id0", "id1", "id2"], "the three oldest go, and only those");
  assert.equal(pure.sweepable({ a: { name: "x", at: 1 } }).length, 0, "under the bound, nothing");
});
