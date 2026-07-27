// Tests for the Channels listener's seed-vs-missed decision (`seedModeFor` in
// listener-io.js). This is the correctness-critical rule behind offline
// catch-up: a channel the app has already seeded must NOT re-suppress messages
// that arrived while it was quit/asleep — they have to surface as real triggers.
//
// Run: `node --test dopl-desktop-app/test/seed-decision.test.mjs`
//
// WHY SOURCE EXTRACTION: listener-io.js is CommonJS and pulls in electron-store,
// so it cannot be imported under `node --test`. `seedModeFor` is deliberately a
// PURE function fenced by BEGIN/END sentinel comments (no electron/fs/store
// refs), so this test reads the real source, slices the fenced block, and
// evaluates it verbatim — the test stays honest to what ships.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "listener-io.js"), "utf8");

// Match from the `//` so the slice starts on a comment, not mid-comment.
const BEGIN = "// ─── BEGIN SEED-DECISION";
const END = "// ─── END SEED-DECISION";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SEED-DECISION sentinel missing");
assert.notEqual(to, -1, "END SEED-DECISION sentinel missing");
assert.ok(to > from, "seed-decision sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { seedModeFor } = new Function(
  `${BLOCK}\n   return { seedModeFor };`
)();

// ── The rule ─────────────────────────────────────────────────────────────────
// seeded === false  -> seed  (true)  : first-ever watch, drain backlog quietly
// seeded === true   -> live  (false) : already caught up, surface missed msgs

test("never-seeded channel -> seed mode (suppress first-watch backlog)", () => {
  assert.equal(seedModeFor(false), true);
});

test("already-seeded channel -> live mode (surface missed messages)", () => {
  // THE offline-catch-up guarantee: on relaunch after a full quit (or a wake
  // after sleep), a seeded channel must NOT re-enter seed mode, or genuinely-
  // missed messages get swallowed as backlog and never prompt.
  assert.equal(seedModeFor(true), false);
});

test("cursor does NOT flip the decision (only the seeded flag does)", () => {
  // A partially-advanced cursor means a channel interrupted MID first-watch: it
  // must keep seeding so the untouched remainder of a large history is not
  // replayed as a burst of prompts. So a never-seeded channel stays in seed mode
  // regardless of cursor value, and a seeded channel stays live regardless.
  for (const cursor of [0, 1, 42, 999999]) {
    assert.equal(seedModeFor(false, cursor), true, `never-seeded @cursor=${cursor}`);
    assert.equal(seedModeFor(true, cursor), false, `seeded @cursor=${cursor}`);
  }
});

test("truthiness: only a strictly-true seeded flag goes live", () => {
  // shouldSeed() feeds this the persisted boolean; belt-and-suspenders that a
  // missing/blank flag is treated as never-seeded (seed, don't surface backlog).
  assert.equal(seedModeFor(undefined), true);
  assert.equal(seedModeFor(null), true);
  assert.equal(seedModeFor(0), true);
  assert.equal(seedModeFor(""), true);
});
