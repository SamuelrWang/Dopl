// AXIS B's WINDOWLESS FLOOR — one rule, three lanes (F-236).
//
// ⚠ THE HOLD BELOW IS DELETED (2026-09-25, Samuel's ruling 5): `session-gate.js` feeds every
// message in every posture, so no reply can be stranded any more. The floor keeps its other job —
// Axis B's IN half is what admits a session's OWN-CHANNEL READS (`grantDecision`), and a windowless
// session has no gate surface, so a gated read is a DENIED read. The history is kept below.
//
// ── THE BUG THIS FILE WAS WRITTEN FOR ────────────────────────────────────────────────
// A WINDOWLESS session has NO ACCEPT SURFACE. `session-gate.js › enqueue` HELD an inbound
// reply whenever `autoInbound(s)` is false, and the entire family that used to release one —
// `decideInbound`, `drainQueue`, `drainInbound` — was deleted with the session window (F-228),
// on the stated grounds that "a windowless session's message axis is FLOORED at auto_inbound,
// so the queue never holds".
//
// ⚠ THAT WAS TRUE OF THE LAUNCH LANES AND OF NOTHING ELSE. `channel-prefs.js ›
// windowlessMessageMode` floors both spawn paths, but NOTHING floored a mode set on a session
// ALREADY RUNNING — and `session-reopen.js › setModeByTask` accepted all four values, reachable
// in one gesture from the agent view's Messages select. Set it to "Ask each time" and the next
// peer reply is held on a session with no way to accept it: the session parks at
// `awaiting_inbound` forever, `io.noteGatedBody` records the body, and session-seed and
// session-history both filter it out — so the message is invisible to the agent PERMANENTLY.
// That is the AUDIT D2 failure `session-gate.js` was written to prevent, reached from the
// other end.
//
// ── WHAT THE FIX IS ──────────────────────────────────────────────────────────────────
// `session-profiles.js › floorWindowlessMessage` is the ONE statement of the floor, and
// `setModeByTask` applies it when the resolved session is windowless. It CLAMPS, never
// refuses: an operator asking for `auto_outbound` wanted less supervision on the OUT half and
// gets exactly that, and a refusal would leave the select showing a value main is not
// enforcing — which is the lie that surface has already been fixed for twice.
//
// ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT. Axis B decides whether a MESSAGE crosses, never
// what a tool may do; `grantDecision` returns off Axis B before Axis A is consulted, and the
// profile is checked first. A floored session still cannot post out without the outbound gate.
//
// ── THE TWIN FILE (2026-08-22) ───────────────────────────────────────────────────────
// AXIS A HAS A WINDOWLESS FLOOR OF ITS OWN NOW — `floorWindowlessTool`, floored at `auto`,
// because the same missing surface that holds an inbound reply forever also turns a GATED TOOL
// into a silent deny. It lives beside this one in `session-profiles.js` and is pinned in
// `session-tool-floor.test.mjs`. The two are NOT symmetrical in where they apply: this one
// writes STATE at two lanes, that one is applied at the READ in `session-io.js › grantArgs` and
// leaves state alone. Both files say why.
//
// Run: `node --test dopl-desktop-app/test/session-mode-floor.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const read = (p) => readFileSync(M(p), "utf8");

const profiles = require(M("session-profiles.js"));
const { floorWindowlessMessage, MESSAGE_MODES, autoInboundMode } = profiles;

// ── 1. THE RULE ──────────────────────────────────────────────────────────────────────

test("the floor raises the IN half and never touches the OUT half", () => {
  assert.equal(floorWindowlessMessage("ask"), "auto_inbound");
  assert.equal(floorWindowlessMessage("auto_outbound"), "auto_both");
  assert.equal(floorWindowlessMessage("auto_inbound"), "auto_inbound");
  assert.equal(floorWindowlessMessage("auto_both"), "auto_both");
});

test("EVERY message mode floors to one that admits own-channel reads — the property, not the table", () => {
  // Stated over the axis rather than over four literals: whatever the operator picks,
  // `autoInboundMode` must answer TRUE afterwards, because that is the predicate `grantDecision`
  // admits an own-channel read on. A fifth message mode fails here rather than denying reads.
  for (const mode of MESSAGE_MODES) {
    assert.equal(autoInboundMode(floorWindowlessMessage(mode)), true, mode);
  }
});

test("the floor is fail-closed on junk, like every other mode read", () => {
  // `normalizeMessageMode` resolves an unknown value to `ask`, which then floors — so an
  // unknown value lands on the most restrictive mode that is still SAFE for this shape.
  for (const junk of [undefined, null, "", "nonsense", 7, {}, []]) {
    assert.equal(floorWindowlessMessage(junk), "auto_inbound", JSON.stringify(junk));
  }
});

test("the floor never LOWERS supervision on the out half", () => {
  // Widen-only in one direction: nothing may come back auto-out that did not go in auto-out.
  const autoOut = (m) => m === "auto_outbound" || m === "auto_both";
  for (const mode of MESSAGE_MODES) {
    if (!autoOut(mode)) {
      assert.equal(autoOut(floorWindowlessMessage(mode)), false,
        `${mode} must not gain auto-send by being floored`);
    }
  }
});

// ── 2. THE LIVE LANE APPLIES IT ──────────────────────────────────────────────────────

/** `setModeByTask`, sliced with the engine's internals faked. */
function harness({ windowless = true, state = {} } = {}) {
  const src = read("session-reopen.js");
  // ⚠ TWO FUNCTIONS ARE SLICED SINCE 2026-08-21, not one: `setModeByTask` resolves its session
  // through `resolveSession`, the ONE statement of the multiplayer resolution rule (an
  // `agentId` matches exactly; none takes the oldest live agent on the thread). Slicing the op
  // without it would evaluate to a ReferenceError, and stubbing it would test a resolution
  // this file does not ship.
  const body = fnOf(src, "resolveSession") + "\n" + fnOf(src, "setModeByTask");
  const dispatched = [];
  const s = {
    key: "chan-1:task-1:a1b2c3d4",
    agentId: "a1b2c3d4",
    settled: false,
    windowless,
    state: { toolMode: "manual", messageMode: "auto_inbound", ...state },
  };
  const sessions = new Map([[s.key, s]]);
  const fn = new Function(
    "deps", "store", "floorWindowlessMessage", "privateTurn",
    `${body}\n return setModeByTask;`
  )(
    {
      sessions,
      dispatch: (sess, ev) => {
        dispatched.push(ev);
        if (ev.type === "set_message_mode") sess.state.messageMode = ev.mode;
        if (ev.type === "set_tool_mode") sess.state.toolMode = ev.mode;
      },
    },
    {
      sessionKey: (c, t, a) => `${c}:${t}:${a || ""}`,
      slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
      threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:`,
    },
    floorWindowlessMessage,
    // The REAL module: it is what reads the mode in the session's own words (C2).
    require(join(HERE, "..", "main", "session-private.js"))
  );
  return { fn, dispatched, s };
}

const CH = "chan-1";

test("LIVE: `ask` on a windowless session is clamped to auto_inbound, not stored as asked", () => {
  // ⚠ THE REGRESSION CASE. Before the floor this dispatched `mode: 'ask'`, and the very next
  // peer reply was held with nothing able to accept it.
  const h = harness();
  const res = h.fn({ channelId: CH, taskId: "task-1", axis: "messages", mode: "ask" });
  assert.equal(h.dispatched[0].mode, "auto_inbound", "the reducer is handed the floored value");
  assert.equal(res.messages, "auto_inbound", "and the UI is told main's truth, not its own request");
  assert.equal(res.ok, true, "it CLAMPS — a refusal would leave the select ahead of the engine");
});

test("LIVE: `auto_outbound` keeps its auto-send and gains the inbound floor", () => {
  const h = harness();
  const res = h.fn({ channelId: CH, taskId: "task-1", axis: "messages", mode: "auto_outbound" });
  assert.equal(res.messages, "auto_both");
  assert.equal(h.dispatched[0].mode, "auto_both", "the operator's OUT choice survives the floor");
});

test("LIVE: a mode already at or above the floor is passed through untouched", () => {
  for (const mode of ["auto_inbound", "auto_both"]) {
    const h = harness();
    const res = h.fn({ channelId: CH, taskId: "task-1", axis: "messages", mode });
    assert.equal(res.messages, mode);
  }
});

test("LIVE: the TOOL axis is not floored IN STATE — this lane is Axis B's and only Axis B's", () => {
  // ⚠ The two axes are independent, and THIS floor leaking across them would be the exact
  // inversion the split exists to prevent (a message rule answering a tool question).
  //
  // ⚠ REQUIREMENT CHANGE, 2026-08-22 (Samuel's ruling 4). Axis A NOW HAS A WINDOWLESS FLOOR TOO
  // — `session-profiles.js › floorWindowlessTool`, floored at `auto` — and this assertion is
  // still exactly right, because that floor is applied to the READ (`session-io.js › grantArgs`)
  // and deliberately does NOT rewrite the reducer's stored `toolMode`. So the select keeps
  // showing what the operator set, which is what these three lines pin. What it must no longer
  // be read as is "the tool axis has no floor": it does, one lane over, and the whole of it
  // lives in `session-tool-floor.test.mjs`. Deleting this test to make room for that one would
  // drop the only pin on state NOT being rewritten here.
  const h = harness();
  const res = h.fn({ channelId: CH, taskId: "task-1", axis: "tools", mode: "manual" });
  assert.equal(h.dispatched[0].type, "set_tool_mode");
  assert.equal(h.dispatched[0].mode, "manual", "the most restrictive TOOL mode is still reachable");
  assert.equal(res.tools, "manual");
});

test("LIVE: a session that is NOT windowless is left alone", () => {
  // The floor is a fact about having no Accept surface, not about the axis. Nothing in this
  // tree currently mints a windowed session — but writing the clamp as unconditional would
  // hard-code the current shape into a rule that is about a CAPABILITY.
  const h = harness({ windowless: false });
  const res = h.fn({ channelId: CH, taskId: "task-1", axis: "messages", mode: "ask" });
  assert.equal(res.messages, "ask");
});

// ── 3. ONE RULE, TWO LANES ───────────────────────────────────────────────────────────

test("the LAUNCH lane applies the SAME floor function, not a second spelling of it", () => {
  const prefs = read("channel-prefs.js");
  assert.match(prefs, /require\('\.\/session-profiles'\)\.floorWindowlessMessage\(/);
  assert.ok(!/function windowlessMessageMode/.test(prefs), "the launch-time copy is gone");
});

test("2026-09-06: the GATE lane is a THIRD application of the same floor, and it agrees too", () => {
  // ⚠ THE THIRD SITE ARRIVED WITH ITEM 8, AND IT IS THE ONE THAT WOULD HAVE SHIPPED BROKEN.
  // `session-private.js › effectiveMessageMode` now reads the channel's Messaging value LIVE at
  // the gate. That stored value is the operator's PICK and carries NO floor, while the value it
  // replaced (`state.messageMode`) had one applied at launch. Without re-flooring, a windowless
  // session on an `ask` channel — the DEFAULT — would gate its own-channel READS, and a gated
  // read in a windowless session is a DENIED read: the agent could not look at the thread it was
  // answering. That is F-236 reached from the other end.
  const priv = require(M("session-private.js"));
  const src = read("session-private.js");
  // It asks for the SHARED rule rather than re-spelling it — the same statement the live lane
  // makes below, and the reason this file exists at all.
  assert.match(src, /floorWindowlessMessage/, "the gate lane calls the shared floor");
  assert.equal(/function floorWindowlessMessage\s*\(/.test(src), false,
    "session-private.js must not re-declare the floor");
  // ⚠ AND IT AGREES MODE FOR MODE, driven through the REAL exported function. A windowless
  // session is floored; a windowed one is not, so the operator's pick stands as written.
  for (const mode of MESSAGE_MODES) {
    const windowless = { channelId: CH, windowless: true, state: { messageMode: mode } };
    const windowed = { channelId: CH, state: { messageMode: mode } };
    // ⚠ NO STORE IN THIS PROCESS, so the live read answers `''` and the FROZEN value is used —
    // which is already floored at launch. What this pins is that the two lanes cannot disagree
    // about a mode, whichever one supplied it.
    assert.equal(priv.effectiveMessageMode(windowless), mode, `windowless ${mode}`);
    assert.equal(priv.effectiveMessageMode(windowed), mode, `windowed ${mode}`);
  }
});

test("the live lane takes the SHARED floor, not a local copy of it", () => {
  // A second spelling in `session-reopen.js` would pass every case above and drift on the next
  // change to the axis — the F-221 shape, applied to a rule instead of a predicate.
  const src = read("session-reopen.js");
  assert.match(src, /require\('\.\/session-profiles'\)/, "the shared rule, imported");
  assert.match(src, /floorWindowlessMessage\(/, "and actually called");
  assert.equal(/function floorWindowlessMessage\s*\(/.test(src), false,
    "session-reopen.js must not re-declare the floor");
});
