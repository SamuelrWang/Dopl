// M3 — the replay ring must never lose the session's ENFORCED PERMISSION POSTURE.
//
// THE BUG. The ring pinned a STICKY HEAD: `entries[0]`, and only when that entry was an
// `init`. But main/session-engine.startSession emits `folder` FIRST and the preset `modes`
// SECOND, and the SDK's `init` lands later still — so entry 0 is display-only chrome and the
// position-based pin protected NOTHING. On a long session drop-oldest ate `init` and `modes`
// like any other entry.
//
// WHY `modes` MATTERS. renderer/session/session-viewmodel.initialState starts at the MOST
// RESTRICTIVE pair (toolMode "manual", messageMode "ask") and the `modes` case is the only
// thing that moves it; session.js paints that pair as the header posture line. Main mean-
// while keeps enforcing the REAL posture off `s.state` (main/session-io.grantArgs feeds
// s.state.toolMode / s.state.messageMode to grantDecision), which a replay never touches.
// So an evicted `modes` left the header claiming manual/ask over a session actually running
// bypass/auto_both: the UI UNDERSTATES what is being allowed, which is the dangerous
// direction — the operator reads "every tool asks me" while nothing asks.
//
// THE FIX: pinning is TYPE-BASED, not positional — eviction skips `init` and `modes`
// wherever they sit — and `modes` is LAST-WINS, so the repeated axis echoes collapse to the
// one live posture instead of packing the ring with unevictable entries.
//
// Same two layers as test/session-replay.test.mjs: slice the pure BEGIN/END ring block and
// evaluate it verbatim, and require createReplay directly. The last test also folds the
// replayed stream through the REAL view-model, so it proves the header, not just the ring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-replay.js"), "utf8");
const { createReplay } = require(join(HERE, "..", "main", "session-replay.js"));
const vm = require(join(HERE, "..", "renderer", "session", "session-viewmodel.js"));

const BEGIN = "// ─── BEGIN SESSION-REPLAY-RING";
const END = "// ─── END SESSION-REPLAY-RING";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.ok(from !== -1 && to > from, "SESSION-REPLAY-RING sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

const ring = new Function(
  `${BLOCK}\n return { createRing, ringRecord, ringDrain, ringOnLoad, ringOnReload, isPinned, oldestEvictable };`
)();

// The exact three payloads startSession emits, in the order it emits them.
const FOLDER = { type: "folder", label: "~/Downloads" };
const modes = (tool, message) => ({ type: "modes", tool: tool, message: message });
const INIT = { type: "init", sessionId: "s1", from: "David", channelName: "Ops", taskTitle: "Ship it" };
const big = (n) => ({ type: "turn", text: "x".repeat(n) });
const AV = "data:image/png;base64," + "A".repeat(350 * 1024);
const pinnedIn = (entries) => entries.filter((e) => e.type === "init" || e.type === "modes");

// ── the pinned SET is type-based, not positional ───────────────────────────────

test("M3: the pinned set is exactly identity + posture; chrome and avatars are not in it", () => {
  assert.equal(ring.isPinned(INIT), true, "identity");
  assert.equal(ring.isPinned(modes("auto", "auto_both")), true, "posture");
  assert.equal(ring.isPinned(FOLDER), false, "the folder label is display-only");
  assert.equal(ring.isPinned({ type: "avatars", self: AV, from: AV }), false, "photos are expendable");
  assert.equal(ring.isPinned({ type: "turn", text: "hi" }), false);
  assert.equal(ring.isPinned(null), false, "a junk payload is never pinned");
});

test("M3: startSession's REAL order — folder first — no longer defeats the pin", () => {
  const r = ring.createRing(6, 1e9);
  ring.ringRecord(r, FOLDER); // emitFolder(s) runs FIRST, so entry 0 is NOT the init
  ring.ringRecord(r, modes("bypass", "auto_both")); // the preset posture, second
  ring.ringRecord(r, INIT); // the SDK system/init lands later still
  assert.equal(ring.oldestEvictable(r), 0, "the folder at index 0 is the first thing eviction takes");
  for (let i = 0; i < 30; i += 1) ring.ringRecord(r, big(50));
  const types = r.entries.map((e) => e.type);
  assert.equal(r.entries.length, 6, "the ring really did evict (a live bound, not a no-op)");
  assert.ok(types.includes("init"), "identity survived from the MIDDLE of the ring");
  assert.ok(types.includes("modes"), "and so did the posture — the whole point of M3");
  assert.ok(!types.includes("folder"), "while the display-only chrome went, as designed");
});

test("M3: a ring of nothing but pinned entries stops evicting instead of spinning", () => {
  const r = ring.createRing(1, 1); // a cap both pins blow through on their own
  ring.ringRecord(r, INIT);
  ring.ringRecord(r, modes("auto", "ask"));
  assert.equal(ring.oldestEvictable(r), -1, "nothing left to give");
  assert.deepEqual(r.entries.map((e) => e.type), ["init", "modes"], "and both are still here");
});

// ── last-wins: at most ONE pinned entry per pinned type ────────────────────────

test("M3: `modes` is LAST-WINS — 200 axis changes leave ONE pinned posture, not 200", () => {
  const r = ring.createRing(50, 1e9);
  ring.ringRecord(r, INIT);
  for (let i = 0; i < 200; i += 1) {
    ring.ringRecord(r, modes(i % 2 ? "auto" : "bypass", "auto_both"));
    ring.ringRecord(r, big(10));
  }
  assert.equal(pinnedIn(r.entries).length, 2, "one init + one modes — pins can never crowd out the ring");
  const m = r.entries.filter((e) => e.type === "modes");
  assert.deepEqual(m, [modes("auto", "auto_both")], "and it is the NEWEST posture (i=199), the live one");
  assert.equal(r.entries.length, 50, "still capped");
  assert.equal(r.entries.filter((e) => e.type === "turn").length, 48, "and still 48/50 real transcript");
});

test("M3: a park's reset to manual/ask is itself the newest posture and replaces the old pin", () => {
  const r = ring.createRing(100, 1e9);
  ring.ringRecord(r, INIT);
  ring.ringRecord(r, modes("bypass", "auto_both"));
  ring.ringRecord(r, { type: "turn", text: "a" });
  ring.ringRecord(r, modes("manual", "ask")); // session-reducer parkEffects echoes both axes reset
  assert.deepEqual(r.entries.map((e) => e.type), ["init", "turn", "modes"],
    "the stale posture left the log; the new one sits in its chronological place");
  assert.deepEqual(r.entries[2], modes("manual", "ask"));
});

test("M3: `init` gets the same single-entry guarantee (a park shell can synthesize a second)", () => {
  const r = ring.createRing(100, 1e9);
  ring.ringRecord(r, INIT);
  ring.ringRecord(r, { type: "turn", text: "a" });
  ring.ringRecord(r, { ...INIT, taskTitle: "Ship it v2" });
  assert.equal(r.entries.filter((e) => e.type === "init").length, 1);
  assert.equal(r.entries[1].taskTitle, "Ship it v2", "the newest identity wins, as the fold would anyway");
});

// ── the sent cursor stays exact when entries leave arbitrary positions ─────────

test("M3: re-recording a pinned type drops a SENT entry mid-ring and the cursor follows", () => {
  const r = ring.createRing(100, 1e9);
  ring.ringRecord(r, FOLDER);
  ring.ringRecord(r, modes("manual", "ask"));
  ring.ringRecord(r, INIT);
  for (const t of ["a", "b"]) ring.ringRecord(r, { type: "turn", text: t });
  ring.ringDrain(r); // everything seen
  assert.equal(r.sentIdx, 5);
  ring.ringRecord(r, modes("bypass", "auto_both")); // removes the SENT modes at index 1
  assert.equal(r.entries.length, 5);
  assert.equal(r.sentIdx, 4, "one already-sent entry left the ring, so the boundary moved with it");
  assert.deepEqual(ring.ringDrain(r), [modes("bypass", "auto_both")], "only the new posture is unseen");
});

test("M3: eviction that SKIPS a pinned entry still keeps the cursor on the boundary", () => {
  const r = ring.createRing(5, 1e9);
  ring.ringRecord(r, FOLDER);
  ring.ringRecord(r, modes("auto", "auto_both"));
  ring.ringRecord(r, INIT);
  for (const t of ["a", "b"]) ring.ringRecord(r, { type: "turn", text: t });
  ring.ringDrain(r);
  assert.equal(r.sentIdx, 5);
  ring.ringRecord(r, { type: "turn", text: "c" }); // over cap -> evicts the SENT folder at index 0
  assert.deepEqual(r.entries.map((e) => e.type), ["modes", "init", "turn", "turn", "turn"]);
  assert.equal(r.sentIdx, 4, "the drop was below the cursor, so it decremented exactly once");
  assert.deepEqual(ring.ringDrain(r).map((e) => e.text), ["c"], "only the genuinely-unseen tail flushes");
});

test("M3: dropping an UNSENT pinned entry leaves the cursor alone (F-08a arithmetic, unchanged)", () => {
  const r = ring.createRing(100, 1e9);
  ring.ringRecord(r, modes("manual", "ask"));
  ring.ringRecord(r, { type: "turn", text: "a" });
  assert.equal(r.sentIdx, 0, "nothing sent yet");
  ring.ringRecord(r, modes("auto", "ask")); // the removed entry was never seen
  assert.equal(r.sentIdx, 0, "so the cursor cannot move");
  assert.deepEqual(ring.ringOnLoad(r).map((e) => e.type), ["turn", "modes"]);
});

// ── the reload, end to end ─────────────────────────────────────────────────────

test("M3 end to end: a reload after heavy overflow replays the ENFORCED posture", () => {
  const sent = [];
  const replay = createReplay({ isDestroyed: () => false }, (p) => sent.push(p));
  replay.deliver(FOLDER); // startSession's real order
  replay.deliver(modes("bypass", "auto_both"));
  replay.onLoad();
  replay.deliver({ ...INIT, selfAvatar: AV, fromAvatar: AV }); // C5 splits the avatars off
  for (let i = 0; i < 60; i += 1) replay.deliver(big(20 * 1024)); // ~1.2MB past the 1MB bound
  replay.onReload();
  sent.length = 0;
  replay.onLoad(); // Cmd-R: the whole surviving transcript re-sends

  const types = sent.map((p) => p.type);
  assert.ok(types.includes("init"), "identity survived (C5)");
  assert.deepEqual(sent.filter((p) => p.type === "modes"), [modes("bypass", "auto_both")],
    "and exactly one posture entry, the live one");
  assert.ok(!types.includes("folder"), "the display-only folder label is still expendable");

  // The consequence, proven through the REAL fold rather than asserted: main/session-io
  // grantArgs is enforcing bypass/auto_both off s.state, and the reloaded header now agrees.
  const state = sent.reduce((st, p) => vm.reduceEvent(st, p), vm.initialState());
  assert.equal(state.toolMode, "bypass");
  assert.equal(state.messageMode, "auto_both");
  assert.notEqual(state.toolMode, vm.initialState().toolMode,
    "before the fix the fold stayed on the restrictive default and the header UNDERSTATED the real posture");
});

test("M3 end to end: the pre-fix failure mode — a replay WITHOUT `modes` folds to manual/ask", () => {
  // The exact stream a ring that evicted the posture would replay. This is the header the
  // operator saw while grantDecision was still being handed bypass/auto_both.
  const state = [INIT, big(10)].reduce((st, p) => vm.reduceEvent(st, p), vm.initialState());
  assert.equal(state.toolMode, "manual");
  assert.equal(state.messageMode, "ask");
});
