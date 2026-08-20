// THE PILL VOCABULARY IS A DATABASE CONSTRAINT, NOT A PREFERENCE (F-146 follow-on).
//
// WHY THIS FILE EXISTS. `session-summary.test.mjs` already pins `PILL_STATES` to the
// literal `["working", "idle", "ended"]`. That test is necessary and not sufficient: it
// pins a list against ANOTHER list written in the same repo by the same hand, so the
// obvious way to "add the thinking pill" is to append `'thinking'` in BOTH places, watch
// the suite go green, and ship. Nothing in `test/` would have objected — and the thing
// that would have objected is Postgres, at runtime, on the first push of a thinking
// session, long after the change looked done.
//
// THE CHAIN THAT MAKES THIS A DB CONTRACT, end to end and all in-tree:
//   main/session-summary.js#pillState      -> the ONE derivation (F-142)
//   main/session-summary.js#liveSummary    -> `state: pillState(s.state)`
//   main/session-summary.js#reportEntry    -> the same object, widened with key/workspaceId
//   main/session-state-push.js#reportRow   -> `state` "passed through byte-for-byte"
//   POST -> channel_sessions.state         -> CHECK (state IN ('working','idle','ended'))
// There is no sanitizer, no clamp and no fallback anywhere on that path. A fourth value
// out of `pillState` is a fourth value in the INSERT, and the row is REJECTED — which
// fails the whole workspace's push (the writer sends a set), so one thinking session
// would blank that machine from `read_sessions` rather than merely mis-render one pill.
//
// SO: a `thinking` pill needs a MIGRATION first, and this test is what says so out loud.
// It is deliberately sourced from the .sql rather than from a constant, so widening the
// CHECK is the only way to make room. Do not "fix" a failure here by editing the expected
// set in this file.
//
// (What a `thinking` pill does NOT need is `includePartialMessages`. The window ships a
// Thinking chip today with no stream at all — renderer/session/session-chrome.js
// #thinkingVisible. See the corrected note atop main/session-summary.js.)
//
// ⚠ THIS FILE'S ARGUMENT WAS TAKEN, AND THE ANSWER WAS NOT A MIGRATION (2026-08-20). The
// operator's own cards now say "Thinking…" / "Running Bash", and NOTHING below changed —
// because the finer signal was added BESIDE the pill (`main/session-detail.js › detailFor`,
// on the wire as `detail` + `toolLabel`) rather than inside its vocabulary. `reportRow` picks
// the server row's columns by name, so the local field cannot reach the INSERT this file
// guards. That is the shape to copy for the NEXT "can we show X on a card" question: ask
// whether X has to cross to another machine before you ask what the column allows. Nothing
// here is softened — a `thinking` PILL still needs the migration, and still would break
// every peer surface and the MCP renderer's membership set on the way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load, MAIN } from "./_session-summary-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Every migration, not just the one that creates the table: a later ALTER ... DROP
// CONSTRAINT / ADD CONSTRAINT is exactly how this constraint would move, and reading only
// the CREATE would keep asserting a set the database no longer has.
function migrationSql() {
  const dir = join(HERE, "..", "..", "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

// `CHECK (state IN ('a', 'b'))` -> ["a", "b"]. Collected as a LIST of definitions so a
// second one (a re-ADD in a later migration) is visible rather than silently merged.
function stateCheckSets(sql) {
  const out = [];
  for (const m of sql.matchAll(/CHECK\s*\(\s*state\s+IN\s*\(([^)]*)\)\s*\)/g)) {
    out.push([...m[1].matchAll(/'([a-z_]+)'/g)].map((q) => q[1]));
  }
  return out;
}

test("DB CONTRACT: channel_sessions.state defines the pill vocabulary exactly once", () => {
  const sets = stateCheckSets(migrationSql());
  assert.equal(
    sets.length,
    1,
    `expected ONE CHECK (state IN ...) across supabase/migrations, found ${sets.length}. ` +
      "If the constraint was widened by a later migration, this test must read the LAST " +
      "definition rather than assume there is only one — update it deliberately."
  );
});

test("DB CONTRACT: PILL_STATES is exactly the set the CHECK constraint allows", () => {
  const [allowed] = stateCheckSets(migrationSql());
  const { PILL_STATES } = load();
  assert.deepEqual(
    [...PILL_STATES].sort(),
    [...allowed].sort(),
    "main/session-summary.js#PILL_STATES and channel_sessions.state's CHECK have diverged. " +
      "session-state-push passes `state` through byte-for-byte, so a pill value the CHECK " +
      "does not name is a REJECTED INSERT for the whole workspace's push, not a rendering " +
      "bug. Ship the migration in the same change as the new pill state."
  );
});

test("DB CONTRACT: no input can make pillState emit a value the CHECK would reject", () => {
  const [allowed] = stateCheckSets(migrationSql());
  const { pillState, ACTIVITY_PILL } = load();
  // The engine's real activities, the fallback path, and the two prototype keys the
  // own-property check exists to defend against (session-park's `requestRank` bug).
  const activities = [
    ...Object.keys(ACTIVITY_PILL),
    "constructor", "toString", "hasOwnProperty", "__proto__",
    "thinking", "streaming", "", undefined, null, 0, {},
  ];
  const phases = [
    "launching", "running", "awaiting_permission", "awaiting_inbound",
    "interrupted", "parked", "ended", "thinking", undefined,
  ];
  for (const phase of phases) {
    for (const activity of activities) {
      for (const parked of [true, false, undefined]) {
        const got = pillState({ phase, activity, parked });
        assert.ok(
          allowed.includes(got),
          `pillState({phase:${String(phase)}, activity:${String(activity)}, ` +
            `parked:${String(parked)}}) -> "${got}", which the CHECK would reject`
        );
      }
    }
  }
  // And the two degenerate calls the projection really can receive (a session whose
  // reducer state has not been attached yet).
  for (const empty of [undefined, null, {}]) {
    assert.ok(allowed.includes(pillState(empty)), `pillState(${String(empty)}) escaped the set`);
  }
});

test("DB CONTRACT: session-state-push still passes `state` through, adding no clamp", () => {
  const src = readFileSync(join(MAIN, "session-state-push.js"), "utf8");
  // The pass-through is what makes the CHECK the binding constraint. If a future change
  // clamps or maps here, the two tests above stop being load-bearing and this one says so.
  assert.match(
    src,
    /state:\s*\(e && e\.state\) \|\| '',/,
    "reportRow no longer forwards the derived pill state verbatim. If a clamp was added, " +
      "the DB is no longer the thing that catches a bad pill value — revisit this suite."
  );
  assert.ok(
    !/'thinking'|"thinking"/.test(src),
    "session-state-push must not learn a pill vocabulary of its own (F-142: one derivation)"
  );
});
