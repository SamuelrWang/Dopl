// AXIS B's WINDOWLESS FLOOR — one rule, two lanes, and the hold it prevents (F-236).
//
// ── THE BUG THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
// A WINDOWLESS session has NO ACCEPT SURFACE. `session-gate.js › enqueue` HOLDS an inbound
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

test("EVERY message mode floors to one that auto-accepts inbound — the property, not the table", () => {
  // ⚠ THE ASSERTION THAT ACTUALLY MATTERS, stated over the axis rather than over four literals:
  // whatever the operator picks, `session-gate.js › autoInbound` must answer TRUE afterwards,
  // because that is the predicate deciding whether a reply is held. A fifth message mode added
  // to the axis fails here rather than silently reintroducing the hold.
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
  const resolver = src.slice(src.indexOf("function resolveSession("), src.indexOf("// PURE READ —"));
  const body = resolver + src.slice(src.indexOf("function setModeByTask("), src.indexOf("// ── THE DIRECT 1:1 LANE"));
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
    "deps", "store", "floorWindowlessMessage",
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
    floorWindowlessMessage
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

test("the LAUNCH lane and the LIVE lane agree, mode for mode", () => {
  // ⚠ TWO SPELLINGS OF ONE FLOOR IS HOW ONE LANE STARTS HOLDING MESSAGES THE OTHER RELEASES.
  // `channel-prefs.js › windowlessMessageMode` is the launch-time derivation: it takes the
  // channel's durable auto-send setting AND a picked mode, and its `picked` half must land on
  // exactly what the live clamp lands on. Driven through the real sliced function with
  // auto-send OFF, which is the input that isolates the `picked` half.
  const prefs = read("channel-prefs.js");
  const body = prefs.slice(
    prefs.indexOf("function windowlessMessageMode("),
    prefs.indexOf("function launchStartModes(")
  );
  const windowlessMessageMode = new Function(
    "getAutoSend",
    `${body}\n return windowlessMessageMode;`
  )(() => false);

  for (const mode of MESSAGE_MODES) {
    assert.equal(
      windowlessMessageMode(CH, mode),
      floorWindowlessMessage(mode),
      `the two lanes disagree about ${mode}`
    );
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

test("the hold this prevents is still UNRELEASABLE — the reason the floor is not optional", () => {
  // ⚠ THE STANDING CONDITION. If an accept surface ever returns, this floor becomes a product
  // choice rather than a correctness one; while it does not exist, a held inbound turn on a
  // windowless session cannot be released by anything. Pinned as an absence so that whoever
  // builds the surface reads this file first.
  const gate = read("session-gate.js").replace(/\/\/[^\n]*/g, "");
  for (const gone of ["decideInbound", "drainQueue", "drainInbound", "feedInboundForTask"]) {
    assert.equal(gate.includes(gone), false, `${gone} is deleted — nothing can release a hold`);
  }
  const windowless = read("session-windowless.js").replace(/\/\/[^\n]*/g, "");
  assert.equal(/inbound_pending/.test(windowless), false,
    "claimGate handles outbound_gate and permission_request only — a held inbound reaches no surface");
});
