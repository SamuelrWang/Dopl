// A SURFACE MAY ONLY CLAIM WHAT MAIN ACTUALLY DID — the v2.7 stream-rework FIX ROUND, rewritten
// down on 2026-08-20 when the v1 session window went (F-228).
//
// The wave had one theme and five findings. What survives is the theme's LOAD-BEARING half, the
// one that lives entirely in main:
//
//   F1  session:permission reported {ok:true} for ANY live session, even when no live
//       canUseTool resolver was awaiting that requestId (a park's denyPending had already
//       fail-closed it). A Send racing a park therefore stamped a denied post 'sent' forever,
//       because the park's permission_resolved{deny} echo only touches a card still 'pending'.
//       resolvePerm knows the truth; `dispatch` returns it. THAT return value is what this file
//       is about, and it is unchanged by F-228 — the reporter on the other end is gone, the
//       truth-teller is not.
//   F4  the outbound gate carries the AUTHORIZED BYTES: the decision surface is sourced from the
//       canUseTool input rather than from a separately streamed copy. The CARD that rendered it
//       is deleted; `outbound_gate` is not — main/session-windowless.js consumes it — so the two
//       main-side halves of F4 (what makeCanUseTool emits, and the SDK options that keep the
//       emitted bytes honest) are still driven here. See the ⚠ block in §F4 for the three
//       view-model cases that went.
//
// ⚠ WHAT WENT, in one line each, with the full argument at each site below: the F1/F7 IPC +
// renderer pins (§F1), the L1 posture-handler cases (§L1), the F4/F5 card reducer cases, F2/F8
// (the two right-lane surfaces) and the NIT (a missing formatter must throw at load).
//
// Layers: source extraction for the electron-bound engine (the same idiom the rest of test/
// uses) and a direct require for the electron-free session-io. There is no renderer layer left
// in this file and no regex pin on one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);

const ENGINE = readFileSync(M("session-engine.js"), "utf8");
// ⚠ `resolvePerm` AND `denyPendingPermissions` MOVED TO `main/session-permissions.js` ON
// 2026-08-22 (the §2 cap, and the DENIAL COPY: a windowless auto-deny is not a decision, so it
// may not say "Denied by operator"). Nothing this file pins changed — the verdict is still
// "did a live awaited resolver really take it", and `dispatch` still propagates it — but the
// slice now reads two sources, and the harness's `denyPending` mirror follows the moved one.
const PERMS = readFileSync(M("session-permissions.js"), "utf8");
// §3 SPLIT: buildSdkOptions + the query lifecycle live in main/session-query.js now.
const QUERY = readFileSync(M("session-query.js"), "utf8");
const io = require(M("session-io.js"));

const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const POST = { op: "post", body: "Shipping the invoice import tonight." };

// ── the REAL reducer + the REAL engine plumbing, sliced out of the shipped source ────
// session-engine.js is electron-bound, so (like every other main-process test here) the two
// functions under test are sliced from the file and evaluated verbatim. `runEffect` itself
// cannot be sliced — it reaches store / io / the surface — so the harness below implements
// exactly two of its cases: resolvePermission (delegating to the REAL sliced resolvePerm) and
// denyPending, whose shipped body is regex-pinned in the next test so it cannot drift.

const cut = (from, to) => {
  const a = ENGINE.indexOf(from);
  const b = ENGINE.indexOf(to);
  assert.ok(a !== -1 && b > a, `engine slice ${from} not found`);
  return ENGINE.slice(a, b);
};

// §2 SPLIT: the pure block now spans session-effects.js + session-reducer.js; the shared
// helper slices BOTH sentinel pairs and evaluates them as one program (require still absent).
const RED = loadReducer();

function harness() {
  const emitted = [];
  // §3.3: `dispatch` also pokes the session-pill projection, which is where a pill's state
  // can move — via `noteActivity(s)` since the Agents tab's activity stamp joined it (wiring
  // plan Phase 5, 2026-08-18; the stamp lives with the projection that reads it). It is a
  // fire-and-forget notification with no return value and no say in the decision, so the fake
  // records the pokes and nothing else — but it has to EXIST, or the sliced dispatch throws a
  // TypeError into an already-finished test, which is how this stub earned its comment twice.
  // ⚠ AND A THIRD TIME ON 2026-08-20: `dispatch` now also feeds the NARRATION RING (the
  // agent window's work lane, F-212), on the same one-line funnel and with the same
  // fire-and-forget shape — no return value, no say in the decision. Stubbed for the same
  // reason and counted into the same tally: what this file is about is the DECISION's truth
  // value, and a projection poke must never be able to change it.
  const touched = { count: 0 };
  const api = new Function(
    "sessionReducer",
    "record",
    "sessionSummary",
    "sessionNarration",
    `${cut("function dispatch(s, event) {", "function runEffect(s, eff) {")}
     ${PERMS.slice(PERMS.indexOf("function denialMessage(s, requestId) {"), PERMS.indexOf("module.exports = {"))}
     function runEffect(s, eff) {
       if (eff.type === 'resolvePermission') return resolvePerm(s, eff.requestId, eff.decision);
       if (eff.type === 'denyPending') {
         for (const resolve of s.pendingPermissions.values()) resolve({ behavior: 'deny', message: 'Session paused' });
         s.pendingPermissions.clear();
         s.pendingNames.clear();
         return undefined;
       }
       record(eff);
       return undefined;
     }
     return { dispatch, resolvePerm };`
  )(RED.sessionReducer, (eff) => emitted.push(eff), {
    noteActivity: () => { touched.count += 1; },
    touch: () => { touched.count += 1; },
  }, {
    note: () => { touched.count += 1; },
  });
  return { ...api, emitted, touched };
}

// A session shaped like the engine's, gated through the REAL canUseTool bridge so
// pendingPermissions / pendingNames are populated exactly as they are in production.
function gatedSession(h) {
  const s = {
    profile: "full",
    channelId: "ch1",
    counterpartyName: "David",
    state: RED.initialSessionState(),
    pendingPermissions: new Map(),
    pendingNames: new Map(),
  };
  s.state = RED.sessionReducer(s.state, { type: "launched", payload: { type: "init" } }).state;
  const settled = []; // what the SDK's canUseTool promise finally resolves to
  io.makeCanUseTool(s, h.dispatch)(CHANNEL_TOOL, POST, { requestId: "r1", toolUseID: "t1" })
    .then((v) => settled.push(v));
  return { s, settled };
}

test("F1: a decision on a LIVE resolver reports true and really resolves the SDK promise", async () => {
  const h = harness();
  const { s, settled } = gatedSession(h);
  assert.equal(s.pendingPermissions.size, 1, "the post is parked on an operator button");
  const ok = h.dispatch(s, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: s.pendingNames.get("r1") });
  assert.equal(ok, true, "only in this case may a caller report {ok:true}");
  await Promise.resolve();
  assert.deepEqual(settled, [{ behavior: "allow" }]);
  assert.equal(s.pendingPermissions.size, 0);
});

test("F1: the SAME decision after a PARK reports FALSE — nothing live was left to decide", async () => {
  const h = harness();
  const { s, settled } = gatedSession(h);
  // The real park: deny-close every awaited request (denyPending FIRST), then echo
  // permission_resolved{deny} for it, which is what resolves the decision to "Not sent".
  assert.equal(RED.sessionReducer(s.state, { type: "idle_timeout" }).effects[0].type, "denyPending");
  h.dispatch(s, { type: "idle_timeout" });
  await Promise.resolve();
  assert.equal(s.state.parked, true);
  assert.deepEqual(settled, [{ behavior: "deny", message: "Session paused" }], "the post was already denied");
  assert.ok(
    h.emitted.some((e) => e.type === "emit" && e.payload.type === "permission_resolved" && e.payload.decision === "deny"),
    "and the surface heard about it"
  );

  const ok = h.dispatch(s, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: undefined });
  assert.equal(ok, false, "a Send that raced the park must NOT be reported as taken");
  assert.equal(settled.length, 1, "and it certainly does not resolve the promise twice");
  // FIX F7's other half, from the side that survives: an undefined grant name never reaches
  // allowForTask. The IPC guard that refused an untracked requestId upstream is deleted
  // (see the ⚠ block below) — this is the reducer-level backstop it sat in front of, and it
  // was always the one that mattered, because there is no live resolver either way.
  assert.deepEqual(s.state.allowForTask.filter((n) => n === undefined), []);
});

test("F1: resolvePerm is the single truth-teller (unknown / already-taken ids report false)", () => {
  const h = harness();
  const s = { pendingPermissions: new Map(), pendingNames: new Map() };
  const taken = [];
  s.pendingPermissions.set("r1", (v) => taken.push(v));
  s.pendingNames.set("r1", CHANNEL_TOOL + "#post");
  assert.equal(h.resolvePerm(s, "nope", "allow"), false, "an unknown requestId decides nothing");
  assert.equal(h.resolvePerm(s, "r1", "allow"), true);
  assert.deepEqual(taken, [{ behavior: "allow" }]);
  assert.equal(h.resolvePerm(s, "r1", "allow"), false, "a second decision finds no resolver");
  assert.equal(s.pendingNames.has("r1"), false, "both maps are cleared together");
});

test("F1: the shipped engine really propagates that verdict (and denyPending is mirrored above)", () => {
  assert.match(ENGINE, /for \(const eff of effects\) resolvedLive = runEffect\(s, eff\) === true \|\| resolvedLive;/);
  assert.match(ENGINE, /\n {2}return resolvedLive;\n\}/, "dispatch returns it");
  assert.match(ENGINE, /case 'resolvePermission':\n\s*return resolvePerm\(s, eff\.requestId, eff\.decision\);/,
    "the only effect whose return value is read");
  assert.match(PERMS, /s\.pendingPermissions\.clear\(\);\n\s*s\.pendingNames\.clear\(\);/,
    "the harness mirror matches the shipped park teardown");
  assert.match(ENGINE, /case 'denyPending':[\s\S]*?denyPendingPermissions\(s, 'Session paused'\)/,
    "…and the engine still runs it before a park's abort");
});

// ── ⚠ F1/F7's TWO REPORTING PINS ENDED HERE — 2026-08-20, F-228 ──────────────────────
//
// Two tests stood here. The first sliced the `session:permission` registration out of
// main/session-ipc.js and pinned three things about it: no blanket `withSession` {ok:true}
// wrapper, an untracked requestId returning `{ ok: false }` before any dispatch (FIX F7, so
// `name` could never be undefined), and the answer being literally `ok: engine.dispatch(...) ===
// true` (FIX F1, the truth crossing back over IPC). It also pinned the inbound gate's identical
// shape, `gate.decideInbound(...) === true`. The second read main's ANSWER back out in the
// renderer: `renderAll()` on a false verdict so the card stays live, a `.catch` re-enabling the
// buttons on a rejected invoke, and the click locking the card before the invoke resolved.
//
// ⚠ BOTH ENDPOINTS ARE DELETED, and this is the one place in the file where that is the whole
// story rather than half of it. `main/session-ipc.js` went with the window it served;
// `gate.decideInbound` went with the HELD-reply accept surface (main/session-gate.js says why:
// a windowless session's message axis is floored at auto_inbound, so nothing is ever held);
// `renderer/session/session.js` and `session-render.js` went with the renderer. There is no
// optimistic stamp left to gate on a verdict, because there is no card to stamp.
//
// ⚠ WHAT THIS COSTS, STATED PLAINLY: the four tests above prove `dispatch` TELLS the truth.
// Nothing left in the tree proves a caller READS it — the last two readers were the two above.
// A NEW caller of engine.dispatch that ignores the return value is a regression this file can no
// longer catch, and the test that catches it belongs next to that caller, not here.

// ── ⚠ L1's POSTURE-HANDLER CASES ENDED HERE — 2026-08-20, F-228 ──────────────────────
//
// Three tests and a `modeHarness`, from the adversarial review of the 2026-08-02 posture wave.
// `session:set-tool-mode` and `session:set-message-mode` ran ONE callback carrying both the
// reducer dispatch and AXIS B's `gate.drainInbound`, and answered {ok:false} whenever it threw —
// so a drain that threw reported a refusal for a mode main had ALREADY applied, and the
// renderer's revert belt then pulled the select back over a posture the gate was enforcing. The
// F1 defect, pointing the other way. The fix made the two steps separate arguments: only the
// dispatch can fail the call. The three cases were (1) a drain that throws still answers the
// mode main is enforcing, (2) only a dispatch failure answers {ok:false} and never reaches the
// drain, (3) AXIS A has no drain step at all.
//
// ⚠ ALL THREE WERE ABOUT AN ANSWER NOBODY RETURNS ANY MORE. Both handlers lived in
// main/session-ipc.js (deleted) and `gate.drainInbound` is deleted from main/session-gate.js
// (deleted with the whole hold path — nothing can be held, so nothing can be drained). An
// {ok:false} that no code emits cannot be asserted, and a fake one asserted against a fake
// handler is the "regex over source text" failure §14 names.
//
// ⚠ AND THE SURVIVING HALF IS ALREADY PINNED, WHICH IS WHY THIS IS A COMMENT AND NOT A REWRITE.
// The rules these cases rested on are reducer rules, and test/session-reducer.test.mjs § "the two
// axes" drives all of them against the REAL reducer: one axis moves, the other does not, a single
// `modes` echo is the ONLY effect either event produces ("an axis change NEVER drains the pending
// dock"), both coerce fail-closed, and a settled session ignores both. Re-stating them here would
// be a second copy of that file's assertions, not a recovered guard.
//
// ⚠ ONE JOIN IS GENUINELY THIN NOW, and it is worth naming rather than quietly losing: that the
// field the reducer writes (`state.messageMode`) is the field the gate READS
// (`session-gate.autoInbound`). test/session-permission-axes.test.mjs owns that pairing — and at
// the time of writing its slice of `autoInbound` still ends on the deleted `windowHasFocus`, so
// that file needs the same treatment this one just had.

// ── F4: what the gate actually hands the decision surface ────────────────────────────

test("F4: main sends the AUTHORIZED bytes, and `to` is the peer NAME (never an id)", () => {
  // ⚠ KEPT WHEN ITS THREE SIBLINGS WENT (2026-08-20): those drove the deleted view-model, this
  // drives main/session-io.js. `outbound_gate` is a LIVE payload — main/session-windowless.js is
  // its consumer now — so the rule "the operator decides on the bytes canUseTool is holding, not
  // on a separately streamed copy" still has both a producer and a reader.
  const s = {
    profile: "full", channelId: "ch1", counterpartyName: "David",
    state: { allowForTask: [], autoApprove: false },
    pendingPermissions: new Map(), pendingNames: new Map(),
  };
  const events = [];
  io.makeCanUseTool(s, (_s, ev) => events.push(ev))(CHANNEL_TOOL, POST, { requestId: "r1", toolUseID: "t1" });
  assert.deepEqual(events[0].payload, {
    type: "outbound_gate", requestId: "r1", toolUseId: "t1", ownChannel: true, text: POST.body, to: "David",
    // 2026-08-02: plus the code that explains the gate. AXIS B is at its `ask` default here, so
    // the surface can say WHY it is holding the post instead of just holding it.
    gateReason: "message-approval-required",
  });
  // A bodiless post still gates, with an empty body rather than an undefined one.
  const events2 = [];
  io.makeCanUseTool(s, (_s, ev) => events2.push(ev))(CHANNEL_TOOL, { op: "post" }, { requestId: "r2", toolUseID: "t2" });
  assert.equal(events2[0].payload.text, "");
});

const stripComments = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("F4: includePartialMessages:false and NO hooks option are load-bearing for the gate", () => {
  // ⚠ ALSO KEPT (2026-08-20), and the `hooks` half is the reason: it is asserted NOWHERE ELSE in
  // the suite. Its subject is main/session-query.js, which F-228 did not touch. Two of the four
  // pins below (permissionMode / settingSources) are doubled by test/session-model.test.mjs §3;
  // the other two are only here.
  const opts = QUERY.slice(QUERY.indexOf("function buildSdkOptions(s) {"), QUERY.indexOf("// H1 — SUPERSEDE"));
  assert.match(opts, /includePartialMessages: false,/, "a partial tool_use input must never paint the decision");
  assert.ok(!/hooks/.test(stripComments(opts)), "no PreToolUse hook may rewrite the input the operator approved");
  assert.match(opts, /LOAD-BEARING for v2\.7 L3 \(FIX F4\)/, "and the option site says why");
  // The two pins the whole gate rests on are still here as well.
  assert.match(opts, /permissionMode: 'default'/);
  assert.match(opts, /settingSources: \[\]/);
});

// ── ⚠ THE F4/F5 CARD CASES ENDED HERE — 2026-08-20, F-228 ────────────────────────────
//
// Three tests over `renderer/session/session-viewmodel.js`, all about the OUTBOUND CARD's
// reducer: that a gate carrying a body OVERWRITES the separately streamed copy in the existing
// artifact (and a bodiless gate from an older main leaves it alone), that a gate whose
// stream-time artifact never landed CREATES the card rather than gating invisibly — failing
// suspicious on the destination, `ownChannel` false for anything but an explicit true — and that
// a RESOLVED post is never re-created or re-opened by a late gate.
//
// ⚠ THE VIEW-MODEL IS DELETED, and with it the only thing that ever held card state. The two
// tests above keep the PRODUCER side of F4 (what main emits, and the SDK options that stop
// anything rewriting it); nothing consumes `outbound_gate` into a card any more, so there is no
// consumer side to assert. If a future surface renders one, it re-inherits every case in this
// paragraph — particularly "never re-open a resolved decision", which is the one with teeth.

// ── ⚠ F2 / F8 ENDED HERE — 2026-08-20, F-228 ─────────────────────────────────────────
//
// Two tests over `renderer/session/session.css` and `session-render.js`. F2: after v2.7 L1 moved
// the agent's own text to the RIGHT lane, the operator's bubble and the agent's shared a lane and
// a near-identical fill, so the two roles had to take different SURFACES — and stay surface-only,
// because the lane class owns alignment and a two-class rule would outrank it. F8: the stale
// `makeTurn` comment claiming agent turns take the left lane.
//
// ⚠ BOTH FILES ARE DELETED. This is pure presentation over a renderer that no longer exists;
// nothing about it generalizes to a future surface beyond "two roles in one lane need two
// surfaces", which is a design rule, not a test.

// ── ⚠ THE NIT ENDED HERE — 2026-08-20, F-228 ─────────────────────────────────────────
//
// One test, and the sharpest small rule in the wave: evaluated as a plain browser <script> with
// `globalThis.DoplSessionFormat` absent, the view-model had to THROW `session-format.js did not
// load` rather than degrade. The old `fmt.oneLine || (…)` shims fell back to an UNCAPPED
// String(v), so a missing formatter silently turned every capped one-liner into an unbounded one.
//
// ⚠ BOTH renderer/session/session-viewmodel.js AND session-format.js ARE DELETED. The RULE is
// general and outlives them — a missing dependency fails loudly, never into a silent, less safe
// fallback — and is worth re-applying to any renderer that ships without a build step. There is
// no such renderer in the tree today, which is exactly why it is written down here.
