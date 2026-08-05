// v2.7 stream-rework FIX ROUND. One theme: a surface may only claim what main actually did.
//
//   F1  session:permission reported {ok:true} for ANY live session, even when no live
//       canUseTool resolver was awaiting that requestId (a park's denyPending had already
//       fail-closed it). A Send racing a park therefore stamped a denied post 'sent' forever,
//       because the park's permission_resolved{deny} echo only touches a card still 'pending'.
//       resolvePerm knows the truth; dispatch now returns it and session-ipc reports it.
//   F4  the outbound gate carries the AUTHORIZED BYTES, so the card body is sourced from the
//       canUseTool input rather than the separately streamed copy (and can re-create a card
//       whose stream-time artifact never landed). includePartialMessages:false + the absence
//       of a `hooks` option are what keep the streamed paint honest in the first place.
//   F2  operator vs agent turns share the right lane now, so their SURFACES must differ.
//   F8  the stale "agent turns take the left lane" comment.
//   NIT a missing session-format.js must THROW at load, not degrade to an uncapped oneLine.
//
// Layers: source extraction for the electron-bound engine (the same idiom the rest of
// test/ uses), direct require for the electron-free view-model + session-io, and regex pins
// for the IPC handler shape and the renderer wiring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";
import { fnOf, between } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));

const ENGINE = readFileSync(M("session-engine.js"), "utf8");
// §3 SPLIT: buildSdkOptions + the query lifecycle live in main/session-query.js now.
const QUERY = readFileSync(M("session-query.js"), "utf8");
const IPC = readFileSync(M("session-ipc.js"), "utf8");
const REDUCER = readFileSync(M("session-reducer.js"), "utf8");
const RENDER = readFileSync(R("session-render.js"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");
const vm = require(R("session-viewmodel.js"));
const io = require(M("session-io.js"));

const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const POST = { op: "post", body: "Shipping the invoice import tonight." };
const last = (s) => s.items[s.items.length - 1];

// ── the REAL reducer + the REAL engine plumbing, sliced out of the shipped source ────
// session-engine.js is electron-bound, so (like every other main-process test here) the two
// functions under test are sliced from the file and evaluated verbatim. `runEffect` itself
// cannot be sliced — it reaches store / io / the window — so the harness below implements
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
  // §3.3: `dispatch` now also pokes the session-pill projection, which is where a pill's
  // state can move. It is a fire-and-forget notification with no return value and no say in
  // the decision, so the fake records the pokes and nothing else — but it has to EXIST, or
  // the sliced dispatch throws a ReferenceError into an already-finished test.
  const touched = { count: 0 };
  const api = new Function(
    "sessionReducer",
    "record",
    "sessionSummary",
    `${cut("function dispatch(s, event) {", "function runEffect(s, eff) {")}
     ${cut("function resolvePerm(s, requestId, decision) {", "function runLifecycle(")}
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
  )(RED.sessionReducer, (eff) => emitted.push(eff), { touch: () => { touched.count += 1; } });
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
  assert.equal(ok, true, "session-ipc may report {ok:true} only in this case");
  await Promise.resolve();
  assert.deepEqual(settled, [{ behavior: "allow" }]);
  assert.equal(s.pendingPermissions.size, 0);
});

test("F1: the SAME decision after a PARK reports FALSE — nothing live was left to decide", async () => {
  const h = harness();
  const { s, settled } = gatedSession(h);
  // The real park: deny-close every awaited request (denyPending FIRST), then echo
  // permission_resolved{deny} for it, which is what resolves the card to "Not sent".
  assert.equal(RED.sessionReducer(s.state, { type: "idle_timeout" }).effects[0].type, "denyPending");
  h.dispatch(s, { type: "idle_timeout" });
  await Promise.resolve();
  assert.equal(s.state.parked, true);
  assert.deepEqual(settled, [{ behavior: "deny", message: "Session paused" }], "the post was already denied");
  assert.ok(
    h.emitted.some((e) => e.type === "emit" && e.payload.type === "permission_resolved" && e.payload.decision === "deny"),
    "and the renderer heard about it"
  );

  const ok = h.dispatch(s, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: undefined });
  assert.equal(ok, false, "a Send that raced the park must NOT be reported as taken");
  assert.equal(settled.length, 1, "and it certainly does not resolve the promise twice");
  // FIX F7's other half: the undefined grant name never reaches allowForTask (session-ipc
  // refuses to dispatch an untracked requestId at all — pinned below — and even if it did,
  // there is no live resolver, so nothing about this post changes).
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
  assert.match(ENGINE, /case 'denyPending':[\s\S]*?s\.pendingPermissions\.clear\(\);\n\s*s\.pendingNames\.clear\(\);/,
    "the harness mirror matches the shipped park teardown");
});

test("F1/F7: the IPC handler reports the dispatch verdict and refuses an untracked requestId", () => {
  const handler = IPC.slice(IPC.indexOf("ipcMain.handle('session:permission'"), IPC.indexOf("// ── v2.5 D1"));
  assert.ok(handler.length > 0, "the permission handler is still the first block");
  assert.ok(!/withSession/.test(handler), "no blanket {ok:true} wrapper any more");
  assert.match(handler, /if \(!requestId \|\| !s\.pendingNames\.has\(requestId\)\) return \{ ok: false \};/,
    "FIX F7: an untracked requestId is never dispatched, so `name` can never be undefined");
  assert.match(handler, /ok: engine\.dispatch\(s, \{[\s\S]*?\}\) === true/, "FIX F1: the truth crosses back");
  // The inbound gate's identical shape is what this was modelled on.
  assert.match(IPC, /ok: gate\.decideInbound\(s, p && p\.pendingId, p && p\.decision\) === true/);
});

test("F1/F7: the renderer gates its optimistic stamp on that verdict", () => {
  assert.match(JS, /renderAll\(\); \/\/ main did not take the decision — the card stays live/);
  assert.match(JS, /\.catch\(\(\) => renderAll\(\)\)/, "a rejected invoke re-enables the buttons too");
  assert.match(RENDER, /if \(clicked\) return;\n\s*clicked = true;\n\s*for \(const b of buttons\) b\.disabled = true;/,
    "FIX F7: the click locks the card before the invoke resolves");
});

// ── L1 (2026-08-02): the same rule, on the POSTURE handlers ──────────────────────────
// Same theme, found by the adversarial review of the posture wave. `session:set-tool-mode` and
// `session:set-message-mode` ran ONE callback carrying both the reducer dispatch and AXIS B's
// drainInbound, and answered {ok:false} whenever it threw. A drain that threw therefore reported
// a refusal for a mode main had ALREADY applied, and the renderer's revert belt then pulled the
// select back over a posture the gate was enforcing — the F1 defect, pointing the other way.
// The two steps are separate arguments now: only the dispatch can fail the call.
//
// The REAL handlers and the real modeChange, sliced whole and given what register() is handed in
// production. `drainThrows` / `dispatchThrows` decide which step blows up.

function modeHarness({ drainThrows, dispatchThrows } = {}) {
  const profiles = require(M("session-profiles.js"));
  const handlers = new Map();
  const drained = [];
  const session = { key: "ch:th", senderId: 7, state: RED.initialSessionState({}) };
  const engine = {
    getSessionBySender: (sender) => (sender === session.senderId ? session : null),
    getConsentBySender: () => null,
    dispatch: (s, evt) => {
      if (dispatchThrows) throw new Error("the reducer exploded");
      s.state = RED.sessionReducer(s.state, evt).state;
      return true;
    },
  };
  const src = [
    fnOf(IPC, "touch"),
    fnOf(IPC, "modeChange"),
    between(IPC, "ipcMain.handle('session:set-tool-mode'", "// ── Item 8: the pre-consent Accept", "session-ipc"),
  ].join("\n");
  const gate = { drainInbound: (s) => { drained.push(s.key); if (drainThrows) throw new Error("the gate exploded"); } };
  new Function("ipcMain", "engine", "sessionConsent", "gate", "normalizeToolMode", "normalizeMessageMode", "diag", src)(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    engine, null, gate, profiles.normalizeToolMode, profiles.normalizeMessageMode, () => {}
  );
  return {
    session, drained,
    tool: (mode) => handlers.get("session:set-tool-mode")({ sender: 7 }, { mode }),
    message: (mode) => handlers.get("session:set-message-mode")({ sender: 7 }, { mode }),
  };
}

test("L1: a DRAIN that throws after the dispatch still reports the mode main is enforcing", () => {
  const h = modeHarness({ drainThrows: true });
  assert.deepEqual(h.message("auto_both"), { ok: true, tool: "manual", message: "auto_both" });
  assert.equal(h.session.state.messageMode, "auto_both", "the gate reads this field, and it moved");
  assert.deepEqual(h.drained, ["ch:th"], "the drain really ran, and really threw");
});

test("L1: only a DISPATCH failure answers {ok:false} — that one really applied nothing", () => {
  const h = modeHarness({ dispatchThrows: true });
  assert.deepEqual(h.tool("bypass"), { ok: false });
  assert.deepEqual(h.message("auto_both"), { ok: false });
  assert.equal(h.session.state.toolMode, "manual", "so the renderer's revert is the truth here");
  assert.equal(h.session.state.messageMode, "ask");
  assert.deepEqual(h.drained, [], "and a dispatch that threw never reaches the drain");
});

test("L1: AXIS A has no drain step at all, so its answer cannot depend on one", () => {
  const h = modeHarness({ drainThrows: true });
  assert.deepEqual(h.tool("bypass"), { ok: true, tool: "bypass", message: "ask" });
  assert.deepEqual(h.drained, [], "tool permissions still touch nothing about message flow");
});

// ── F4: the card body is the AUTHORIZED body ─────────────────────────────────────────

const gating = { type: "outbound_post", toolUseId: "t1", to: "David", text: "the streamed copy", pending: true, ownChannel: true };

test("F4: the gate's bytes WIN over the separately streamed copy", () => {
  let s = vm.reduceEvent(vm.initialState(), gating);
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r1", toolUseId: "t1", ownChannel: true, text: POST.body, to: "David" });
  assert.equal(s.items.length, 1, "still ONE artifact");
  assert.equal(last(s).text, POST.body, "the operator approves what canUseTool is holding");
  assert.equal(last(s).requestId, "r1");
  // A gate with no body at all leaves the streamed text alone (an older main).
  const legacy = vm.reduceEvent(vm.reduceEvent(vm.initialState(), gating), { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });
  assert.equal(last(legacy).text, "the streamed copy");
});

test("F4/F5: a gate whose stream artifact never landed CREATES the card", () => {
  const s = vm.reduceEvent(vm.initialState(), {
    type: "outbound_gate", requestId: "r1", toolUseId: "t1", ownChannel: true, text: POST.body, to: "David",
  });
  assert.equal(s.items.length, 1, "the post can never gate invisibly");
  assert.deepEqual(last(s), {
    kind: "outbound", toolUseId: "t1", to: "David", text: POST.body,
    avatarKey: "self", status: "pending", requestId: "r1", ownChannel: true,
  });
  // Fail suspicious on the destination, exactly like the streamed path.
  const cross = vm.reduceEvent(vm.initialState(), { type: "outbound_gate", requestId: "r1", toolUseId: "t1", text: "x" });
  assert.equal(last(cross).ownChannel, false, "anything but an explicit true reads as another channel");
  // A bodiless gate for an unknown tool_use creates nothing (there is nothing to show).
  const none = vm.reduceEvent(vm.initialState(), { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });
  assert.deepEqual(none.items, []);
});

test("F4/F5: a RESOLVED post is never re-created or re-opened by a late gate", () => {
  let s = vm.reduceEvent(vm.initialState(), gating);
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r1", toolUseId: "t1", text: POST.body });
  s = vm.reduceEvent(s, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.equal(last(s).status, "not_sent");
  const late = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r9", toolUseId: "t1", text: POST.body, to: "David" });
  assert.equal(late, s, "no duplicate card, no reopened decision");
});

test("F4: main really sends those bytes, and `to` is the peer NAME (never an id)", () => {
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
    // the card can say WHY it is holding the post instead of just holding it.
    gateReason: "message-approval-required",
  });
  // A bodiless post still gates, with an empty body rather than an undefined one.
  const events2 = [];
  io.makeCanUseTool(s, (_s, ev) => events2.push(ev))(CHANNEL_TOOL, { op: "post" }, { requestId: "r2", toolUseID: "t2" });
  assert.equal(events2[0].payload.text, "");
});

const stripComments = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("F4: includePartialMessages:false and NO hooks option are load-bearing for the card", () => {
  const opts = QUERY.slice(QUERY.indexOf("function buildSdkOptions(s) {"), QUERY.indexOf("// H1 — SUPERSEDE"));
  assert.match(opts, /includePartialMessages: false,/, "a partial tool_use input must never paint the card");
  assert.ok(!/hooks/.test(stripComments(opts)), "no PreToolUse hook may rewrite the input the operator approved");
  assert.match(opts, /LOAD-BEARING for v2\.7 L3 \(FIX F4\)/, "and the option site says why");
  // The two pins the whole gate rests on are still here as well.
  assert.match(opts, /permissionMode: 'default'/);
  assert.match(opts, /settingSources: \[\]/);
});

// ── F2 / F8: the two right-lane roles must not look alike ────────────────────────────

test("F2: the operator's bubble takes a DIFFERENT surface from the agent's", () => {
  assert.match(CSS, /\.bubble\.role-agent \{ background: var\(--card-surface-elevated\); \}/);
  assert.match(CSS, /\.bubble\.role-operator \{ background: var\(--bg-inset\); border-color: var\(--border-strong\); \}/);
  assert.ok(!/\.bubble\.role-operator \{ background: var\(--bg-elevated\)/.test(CSS), "the old near-identical fill is gone");
  // Both stay SURFACE-only: the lane class owns alignment (a 2-class rule would outrank it).
  const roles = CSS.slice(CSS.indexOf(".bubble.role-agent"), CSS.indexOf(".cp-head"));
  assert.ok(!/align-self|max-width/.test(roles));
  // The left lane may share the inset surface — the side is what disambiguates there.
  assert.match(CSS, /\.bubble\.role-counterparty \{ background: var\(--bg-inset\);/);
});

test("F8: the makeTurn comment no longer claims agent turns take the LEFT lane", () => {
  // Sliced to the START of the counterparty block — that factory's comment legitimately says
  // "left lane", because the peer really is the only thing over there now.
  const turn = RENDER.slice(RENDER.indexOf("function makeTurn("), RENDER.indexOf("// The peer's inbound reply"));
  assert.ok(!/left lane/.test(turn), "v2.7 L1 moved the agent's own text to the right");
  assert.match(turn, /BOTH turn roles take the RIGHT lane/);
});

// ── NIT: a missing formatter module fails LOUDLY at load ─────────────────────────────

test("NIT: the view-model THROWS at load when session-format.js is absent", () => {
  const VMSRC = readFileSync(R("session-viewmodel.js"), "utf8");
  assert.equal(globalThis.DoplSessionFormat, undefined, "the sandbox path is what we are exercising");
  // Evaluated as a plain browser <script> would be (no `module`), with the format global
  // missing: the old `fmt.oneLine || (…)` shims degraded silently to an UNCAPPED String(v).
  assert.throws(() => new Function(VMSRC)(), /session-format\.js did not load/);
  const code = stripComments(VMSRC);
  assert.ok(!/fmt\.oneLine \|\|/.test(code), "no silent fallback left");
  assert.ok(!/summarizeToolInput \|\|/.test(code));
});
