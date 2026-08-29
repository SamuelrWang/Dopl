// 🔒 THE NAME DOOR — main's half of the @-mention convention (2026-08-28, Samuel's F-350 ruling).
//
// ⚠ WHAT THIS EXISTS TO STOP COMING BACK. `session-dispatch.js › mentionedAgentIds` resolved
// `@<id>` and `@agent-<id>` only, while the renderer's picker INSERTS the operator's slugged
// custom name (`src/features/channels/lib/agent-mentions.ts › agentMentionHandle` prefers the slug)
// and the transcript TINTS it. Every agent the operator had actually named got a blue token this
// machine ignored: TIER 1 never fired and the agent sat there. F-350.
//
// ⚠ THE RULING'S TWO HALVES ARE PINNED SEPARATELY, because they pull in opposite directions and a
// fix that satisfies one by breaking the other would look green from either side alone:
//   • it WIDENS RECOGNITION — a slug now reaches its agent (the round trip below);
//   • it NEVER LOOSENS THE REFUSAL — unknown, ambiguous and unnamed all still wake nobody.
//
// ⚠ THE PURE BLOCK IS SLICED, not required, for the reason every truth table in this tree gives:
// the same block is what `src/features/channels/lib/agent-handle-parity.test.ts` slices out of this
// same file, so both trees are driving the identical source over the identical fixtures.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MODULE_PATH = join(HERE, "..", "main", "agent-handles.js");
const handles = require(MODULE_PATH);
const SRC = readFileSync(MODULE_PATH, "utf8");

const A1 = "k3v7d2mq";
const A2 = "zzzzzzzz";

/** The index as production builds it: this thread's ids, resolved through the rename store. */
const indexFor = (names) =>
  handles.handleIndexFor(Object.keys(names), (id) => names[id]);

// ── (1) THE SLUG RULE ────────────────────────────────────────────────────────

test("SLUG: lowercase, whitespace runs to one dash — the roster's own convention", () => {
  assert.equal(handles.agentSlug("Research Bot"), "research-bot");
  assert.equal(handles.agentSlug("  RESEARCH   Bot  "), "research-bot");
  // ⚠ AN UNNAMED AGENT CLAIMS NO HANDLE AT ALL, which is what keeps `''` out of the index.
  assert.equal(handles.agentSlug(""), "");
  assert.equal(handles.agentSlug("   "), "");
  assert.equal(handles.agentSlug(null), "");
  assert.equal(handles.agentSlug(undefined), "");
});

test("TOKEN: trailing punctuation and one HTML tag come off; leading punctuation does NOT", () => {
  assert.equal(handles.handleOf("@research-bot"), "research-bot");
  assert.equal(handles.handleOf("@research-bot."), "research-bot");
  // ⚠ F-266's characters. `**@research-bot**` is how a person writes "look at this".
  assert.equal(handles.handleOf("@research-bot**"), "research-bot");
  // ⚠ THE TAG ALONE COMES OFF — the regex is anchored at `$`, so it needs to BE the ending.
  assert.equal(handles.handleOf("@research-bot</b>"), "research-bot");
  // ⚠ AND A TAG WITH A PERIOD AFTER IT DOES NOT, WHICH IS A REAL SHARED LIMITATION rather than a
  // bug on this side. `.` breaks the tag's `$` anchor, so the punctuation class runs first and
  // eats `>` (it is in that class) — leaving `research-bot</b`, which nothing recovers. The TS
  // original's own note names this exact hazard, and the parity suite proves both trees answer
  // the same. Pinned so a "fix" on one side alone fails loudly.
  assert.equal(handles.handleOf("@research-bot</b>."), "research-bot</b");
  // ⚠ LEADING PUNCTUATION STAYS — guessing where a handle STARTS is how an `@` in a URL tags.
  assert.equal(handles.handleOf("@(research-bot"), "(research-bot");
  assert.equal(handles.handleOf("research-bot"), "", "a token with no @ is not a handle");
  assert.equal(handles.handleOf("@"), "");
});

// ── (2) THE REFUSAL, WHICH THE RULING SAYS MUST NOT MOVE ─────────────────────

test("FAIL CLOSED: an UNKNOWN slug names nobody", () => {
  const index = indexFor({ [A1]: "Research Bot" });
  assert.deepEqual(handles.slugMentionedAgentIds("hey @nobody-here take this", index), []);
  assert.deepEqual(handles.slugMentionedAgentIds("no handles at all", index), []);
});

test("FAIL CLOSED: an UNNAMED agent has no slug door — only its id form", () => {
  // ⚠ THE COMMON CASE, and it must produce an EMPTY index rather than an entry under `''`.
  const index = indexFor({ [A1]: null, [A2]: "" });
  assert.equal(index.size, 0);
  assert.deepEqual(handles.slugMentionedAgentIds("@ hey @-- there", index), []);
});

test("FAIL CLOSED: two agents renamed the SAME wake NEITHER by that slug", () => {
  // ⚠ SAMUEL'S EXPLICIT COLLISION CASE. The order the registry happens to iterate must never be
  // what decides which agent a message wakes — `lib/mentions.ts` rule 5, applied here.
  const index = indexFor({ [A1]: "Twin", [A2]: "Twin" });
  assert.equal(index.get("twin"), null, "a contested slug resolves to NEITHER, not to the first");
  assert.deepEqual(handles.slugMentionedAgentIds("@twin please look", index), []);
});

test("FAIL CLOSED: a contested NAME does not cost the agent its ID door", () => {
  // ⚠ THE OTHER HALF OF THE COLLISION RULE. The id form is unambiguous by construction and is
  // never withdrawn, so both twins stay reachable — by the address, not the nickname.
  const index = indexFor({ [A1]: "Twin", [A2]: "Twin" });
  const ids = [A1, A2];
  const { mentionedAgentIds } = sliceDispatch();
  assert.deepEqual(mentionedAgentIds(`@agent-${A1} go`, ids, index), [A1]);
  assert.deepEqual(mentionedAgentIds(`@${A2} go`, ids, index), [A2]);
  assert.deepEqual(mentionedAgentIds("@twin go", ids, index), [], "the nickname still names nobody");
});

test("FAIL CLOSED: a name lookup that THROWS resolves fewer handles, never breaks the route", () => {
  // ⚠ `agent-names.js` IS ELECTRON-STORE BACKED. An unreadable store must cost recognition, not
  // routing — the same rule `session-triage.js › personaFor` follows.
  const index = handles.handleIndexFor([A1, A2], (id) => {
    if (id === A1) throw new Error("store unreadable");
    return "Scout";
  });
  assert.equal(index.get("scout"), A2, "the readable one still resolves");
  assert.equal(index.size, 1);
});

// ── (3) THE ROUND TRIP — what the picker writes is what main resolves ────────

/** `session-dispatch.js`'s routing block, sliced the way its own harnesses slice it. */
function sliceDispatch() {
  const src = readFileSync(join(HERE, "..", "main", "session-dispatch.js"), "utf8");
  const block = src.slice(
    src.indexOf("// ─── BEGIN SESSION-DISPATCH-PURE"),
    src.indexOf("// ─── END SESSION-DISPATCH-PURE")
  );
  assert.ok(block.length > 400, "the dispatch block was not found — this test would pass vacuously");
  return new Function(
    "targeting", "sessionEngine", "io", "wakeTiers", "sessionTriage", "agentHandles", "diag",
    `${block}\n return { mentionedAgentIds };`
  )({}, {}, {}, {}, {}, handles, () => {});
}

/**
 * ⚠ THE PICKER'S OWN RULE, RESTATED HERE ON PURPOSE — `lib/agent-mentions.ts ›
 * agentMentionHandle`: the slugged custom name when there is one, else `agent-<id>`. This is the
 * ONE thing this file copies from the renderer rather than reading, because reading it would mean
 * importing TypeScript. `src/features/channels/lib/agent-handle-parity.test.ts` holds the real
 * function against the same rule, which is what stops this restatement drifting.
 */
const pickerInserts = (agentId, displayName) =>
  handles.agentSlug(displayName) || `agent-${agentId}`;

test("ROUND TRIP: what the picker inserts is what main resolves — RENAMED agent", () => {
  // ⚠ THIS IS F-350 ITSELF, end to end. Before the ruling this returned [] and the agent slept.
  const names = { [A1]: "Research Bot", [A2]: null };
  const index = indexFor(names);
  const { mentionedAgentIds } = sliceDispatch();
  const token = pickerInserts(A1, names[A1]);
  assert.equal(token, "research-bot", "the picker inserts the SLUG for a renamed agent");
  assert.deepEqual(
    mentionedAgentIds(`@${token} can you take this`, [A1, A2], index),
    [A1],
    "the handle the picker wrote must reach the agent it named"
  );
});

test("ROUND TRIP: and for an UNRENAMED agent, which takes the other door", () => {
  const names = { [A1]: "Research Bot", [A2]: null };
  const index = indexFor(names);
  const { mentionedAgentIds } = sliceDispatch();
  const token = pickerInserts(A2, names[A2]);
  assert.equal(token, `agent-${A2}`, "the picker falls back to the id form");
  assert.deepEqual(mentionedAgentIds(`@${token} go`, [A1, A2], index), [A2]);
});

test("ROUND TRIP: the two doors compose, and the ID sorts first", () => {
  const index = indexFor({ [A1]: "Research Bot", [A2]: "Scout" });
  const { mentionedAgentIds } = sliceDispatch();
  // ⚠ ORDER IS THE ADDRESSEE LIST'S, and the framing prints it: the exact address ahead of the
  // friendly one. Both are addressed either way — this pins the ORDER, not the membership.
  assert.deepEqual(
    mentionedAgentIds(`@scout and @agent-${A1} both`, [A1, A2], index),
    [A1, A2]
  );
});

test("ROUND TRIP: a slug naming an agent NOT on this thread reaches nobody", () => {
  // ⚠ THE ROSTER INTERSECTION APPLIES TO BOTH DOORS. An index built for one thread, asked about a
  // roster that no longer holds that agent, must answer nothing — this is the property that makes
  // "an ended agent cannot be @-mentioned into life" true of the name door as well.
  const index = indexFor({ [A1]: "Research Bot" });
  const { mentionedAgentIds } = sliceDispatch();
  assert.deepEqual(mentionedAgentIds("@research-bot go", [A2], index), []);
});

test("ROUND TRIP: no index at all behaves exactly as the build before the ruling", () => {
  // ⚠ THE DEGRADATION IS HONEST, not silent-broken: a caller that passes no index gets the id
  // door and only the id door, which is what every pre-2026-08-28 caller expected.
  const { mentionedAgentIds } = sliceDispatch();
  assert.deepEqual(mentionedAgentIds(`@agent-${A1} go`, [A1], undefined), [A1]);
  assert.deepEqual(mentionedAgentIds("@research-bot go", [A1], undefined), []);
});

// ── (4) THE PRODUCTION CALL SITE ACTUALLY OPENS THE DOOR ─────────────────────

test("WIRING: feedLiveSession builds the index off the rename store and passes it", () => {
  // ⚠ A STRUCTURAL PIN, because the degradation above is INVISIBLE. `mentionedAgentIds` tolerates
  // a missing index by design, so a call site that stopped passing one would take the whole
  // ruling out and every behavioural test in this file would still be green.
  const src = readFileSync(join(HERE, "..", "main", "session-dispatch.js"), "utf8");
  assert.match(
    src,
    /const addressed = mentionedAgentIds\(m\.body, liveIds, agentHandles\.handleIndexFor\(liveIds\)\);/,
    "the fan-out must build the slug index from THIS thread's live ids"
  );
});

// ── (5) THE FIXTURE TABLE IS REAL ────────────────────────────────────────────

test("FIXTURES: the cross-tree table is present and non-trivial on this side too", () => {
  // ⚠ BOTH SUITES ASSERT THE LENGTH, so deleting a row to silence a parity failure fails here.
  assert.equal(handles.PARITY_NAMES.length, 7);
  assert.equal(handles.PARITY_TOKENS.length, 15);
  assert.ok(SRC.includes("BEGIN AGENT-HANDLES-PURE"), "the sliceable block must stay sliceable");
  for (const name of handles.PARITY_NAMES) assert.equal(typeof handles.agentSlug(name), "string");
  for (const token of handles.PARITY_TOKENS) assert.equal(typeof handles.handleOf(token), "string");
});
