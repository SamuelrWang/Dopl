// 🔒 THE NAME MAP IS READ A CONSTANT NUMBER OF TIMES PER PROJECTION (2026-09-15).
//
// ⚠ **THE FIX IT GUARDS SHIPPED WITHOUT IT, AND `docs/specs/desktop-main-cpu.md` SAYS SO IN AS
// MANY WORDS**: *"That test is the durable half of this fix: without it the next field added
// beside `displayName` reintroduces the bug."* The bug it describes is not a slow function — it
// is a function called `1 + 2E + 2L` times per flush, each call a `readFileSync` + `JSON.parse`
// of the whole config file, measured at 254 ms per tick at the retention cap.
//
// ⚠ **`_session-summary-harness.mjs` CANNOT HOST IT — that harness STUBS the store, which is
// exactly why the cost was invisible to every suite that shared it.** So this evaluates the REAL
// `main/agent-names.js` with a COUNTING `electron-store`, which is the only way the read count is
// observable at all.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "agent-names.js"), "utf8");

/** The real module, over a store that counts `get`s. */
function load() {
  const state = { reads: 0, writes: 0, map: {} };
  class CountingStore {
    get() {
      state.reads += 1;
      return state.map;
    }
    set(_key, value) {
      state.writes += 1;
      state.map = value;
    }
  }
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(
    (id) => (id === "electron-store" ? CountingStore : require(id)),
    mod,
    mod.exports
  );
  return { names: mod.exports, state };
}

/** One `session-summary.js › reportList()` pass: two lookups per row, synchronously. */
function projection(names, rows) {
  for (const id of rows) {
    names.displayNameFor(id);
    names.descriptionForAgent(id);
  }
}

const ROWS = Array.from({ length: 200 }, (_, i) => `a${String(i).padStart(7, "0")}`);

test("🔒 a whole projection costs ONE store read, whatever the row count", () => {
  const { names, state } = load();
  projection(names, ROWS);
  assert.equal(state.reads, 1, `400 lookups must not be 400 reads (was ${state.reads})`);
});

test("🔒 …and it is constant in the row count, which is the shape of the bug", () => {
  const small = load();
  projection(small.names, ROWS.slice(0, 5));
  const big = load();
  projection(big.names, ROWS);
  assert.equal(big.state.reads, small.state.reads);
});

test("🔒 a rename is visible to the VERY NEXT read — every writer invalidates", () => {
  const { names } = load();
  names.displayNameFor("a1b2c3d4"); // warm the memo
  names.rename("a1b2c3d4", "Coder");
  assert.equal(names.displayNameFor("a1b2c3d4"), "Coder");
  names.describe("a1b2c3d4", "what it is for");
  assert.equal(names.descriptionForAgent("a1b2c3d4"), "what it is for");
  names.clear("a1b2c3d4");
  assert.equal(names.displayNameFor("a1b2c3d4"), null);
});

test("🔒 the memo does NOT survive the tick — the name is read live across flushes", async () => {
  const { names, state } = load();
  projection(names, ROWS.slice(0, 3));
  const afterFirst = state.reads;
  await new Promise((r) => setImmediate(r));
  projection(names, ROWS.slice(0, 3));
  assert.equal(state.reads, afterFirst + 1, "the next flush must re-read");
});

test("there is no switch back to a read per lookup (P4-29)", () => {
  assert.doesNotMatch(SRC, /DOPL_NAMES_CACHE|process\.env/);
});
