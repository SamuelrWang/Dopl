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

const pure = new Function(
  `${BLOCK}\nreturn { MAX_NAME, MAX_DESCRIPTION, MAX_NAMES, sanitizeName, sanitizeDescription, sweepable, nameFrom, descriptionFrom, patched };`
)();

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

// ── WHAT THE AGENT IS FOR (2026-08-27, Samuel's launch-panel ruling) ─────────
//
// ⚠ THE DESCRIPTION IS PROSE WHERE THE NAME IS A LABEL, and that ONE difference is what these
// cases are about: a description may hold paragraphs, so `\n` must survive where `sanitizeName`
// refuses it outright. Everything else is the same discipline — refuse the invisibles rather
// than strip them, bound the length, never echo.

test("a description keeps its line breaks — the one axis it differs from a name on", () => {
  // ⚠ THE EXACT CHARACTER `sanitizeName` REFUSES. A launch description is a paragraph the
  // operator typed into a textarea; collapsing it would store something they did not write.
  assert.equal(pure.sanitizeDescription("Reviews the diff.\nFlags §5 breaks."),
    "Reviews the diff.\nFlags §5 breaks.");
  assert.equal(pure.sanitizeName("Reviews the diff.\nFlags §5 breaks."), null, "a NAME still refuses it");
  assert.equal(pure.sanitizeDescription("  trims the ends  "), "trims the ends");
  // Interior whitespace is NOT collapsed, unlike a name's — the shape of prose is content.
  assert.equal(pure.sanitizeDescription("two  spaces"), "two  spaces");
});

test("it refuses the invisibles rather than stripping them, exactly as a name does", () => {
  // ⚠ ESCAPES, NOT LITERALS — writing these into the file makes the fixtures invisible in review.
  for (const [label, value] of [
    ["a control character", "Reviews\u0007the diff"],
    ["a zero-width joiner", "Reviews\u200dthe diff"],
    ["a bidi override", "Reviews\u202ethe diff"],
    ["a line separator", "Reviews\u2028the diff"],
    ["a paragraph separator", "Reviews\u2029the diff"],
    ["a BOM", "Reviews\ufeffthe diff"],
  ]) {
    assert.equal(pure.sanitizeDescription(value), null, `${label} must be refused`);
  }
  // ⚠ AND THE THREE THAT ARE LEGAL PROSE, stated so a future tightening has to argue with them.
  for (const ok of ["a\tb", "a\nb", "a\r\nb"]) {
    assert.equal(pure.sanitizeDescription(ok), ok.trim());
  }
});

test("EMPTY is an answer, not a refusal — that is how one op both sets and clears", () => {
  // ⚠ THE ASYMMETRY WITH `sanitizeName` IS DELIBERATE. A nameless agent falls back to
  // `Agent #<id>`; a description simply has none, which is the ordinary case. `''` therefore
  // means "clear it" and `null` means "could not be stored at all".
  assert.equal(pure.sanitizeDescription(""), "");
  assert.equal(pure.sanitizeDescription("   "), "");
  assert.equal(pure.sanitizeDescription(null), null);
  assert.equal(pure.sanitizeDescription(42), null);
});

test("the bound is MAX_DESCRIPTION, and it is the template schema's own number", () => {
  // ⚠ 2000 MIRRORS `agent-templates/schema.ts › DescriptionSchema`. A template's description
  // answers the same question about the same kind of thing, and two caps on one question is how
  // a description that fits one surface is refused by the next.
  assert.equal(pure.MAX_DESCRIPTION, 2000);
  assert.equal(pure.sanitizeDescription("x".repeat(2000)), "x".repeat(2000));
  assert.equal(pure.sanitizeDescription("x".repeat(2001)), null);
});

test("a description that was never set reads null, never a blank", () => {
  assert.equal(pure.descriptionFrom({}, "a1b2c3d4"), null);
  assert.equal(pure.descriptionFrom({ a1b2c3d4: { description: "" } }, "a1b2c3d4"), null);
  assert.equal(pure.descriptionFrom(null, "a1b2c3d4"), null);
  assert.equal(pure.descriptionFrom({ a1b2c3d4: { description: "Audits" } }, "a1b2c3d4"), "Audits");
});

// ── THE MERGE (`patched`) ────────────────────────────────────────────────────
//
// ⚠ THIS IS THE CASE THE WHOLE FIELD TURNS ON. `rename` wrote `map[id] = { name, at }` — a
// whole-row REPLACE — which was correct while `name` was the only thing in the row and silently
// destroys the description now that it is not. Two writers, one row.

test("writing one field KEEPS the other — a rename must not erase the description", () => {
  const withBoth = pure.patched(
    pure.patched({}, "a1b2c3d4", "description", "Audits the diff"),
    "a1b2c3d4", "name", "Research"
  );
  assert.equal(pure.nameFrom(withBoth, "a1b2c3d4"), "Research");
  assert.equal(pure.descriptionFrom(withBoth, "a1b2c3d4"), "Audits the diff",
    "the rename replaced the whole row and took the description with it");

  // …and the other direction: describing does not un-name.
  const redescribed = pure.patched(withBoth, "a1b2c3d4", "description", "Now reviews the specs");
  assert.equal(pure.nameFrom(redescribed, "a1b2c3d4"), "Research");
  assert.equal(pure.descriptionFrom(redescribed, "a1b2c3d4"), "Now reviews the specs");
});

test("clearing ONE field leaves the row; clearing BOTH deletes it", () => {
  const both = pure.patched(
    pure.patched({}, "a1b2c3d4", "name", "Research"),
    "a1b2c3d4", "description", "Audits"
  );
  // ⚠ AN EMPTY RENAME IS "GO BACK TO `Agent #<id>`", which says nothing about what the agent is
  // FOR — so the description outlives it.
  const unnamed = pure.patched(both, "a1b2c3d4", "name", "");
  assert.equal(pure.nameFrom(unnamed, "a1b2c3d4"), null);
  assert.equal(pure.descriptionFrom(unnamed, "a1b2c3d4"), "Audits");
  assert.ok("a1b2c3d4" in unnamed, "the row still holds a description");

  // ⚠ AND A ROW WITH NEITHER FIELD IS DELETED, not left as `{}`. An empty object per agent id
  // is exactly the unbounded growth `MAX_NAMES` exists to bound.
  const empty = pure.patched(unnamed, "a1b2c3d4", "description", "");
  assert.deepEqual(empty, {});
});

test("the merge does not mutate the map it was handed", () => {
  // ⚠ PURE, so the caller decides when the disk is written — `store.set` happens once, in the
  // shell half, with the value this returned.
  const before = { a1b2c3d4: { name: "Research", at: 1 } };
  const after = pure.patched(before, "a1b2c3d4", "description", "Audits");
  assert.deepEqual(before, { a1b2c3d4: { name: "Research", at: 1 } }, "the input was mutated");
  assert.equal(pure.descriptionFrom(after, "a1b2c3d4"), "Audits");
});

test("the sweep still applies to a two-field row, and an empty id writes nothing", () => {
  const map = {};
  for (let i = 0; i < pure.MAX_NAMES; i += 1) map[`id${i}`] = { name: `n${i}`, at: i };
  const grown = pure.patched(map, "newest", "description", "Audits");
  assert.equal(Object.keys(grown).length, pure.MAX_NAMES, "still bounded after the add");
  assert.equal(grown.id0, undefined, "the oldest went");
  assert.equal(pure.descriptionFrom(grown, "newest"), "Audits");
  assert.deepEqual(pure.patched({}, "", "description", "Audits"), {}, "no id, no row");
});
