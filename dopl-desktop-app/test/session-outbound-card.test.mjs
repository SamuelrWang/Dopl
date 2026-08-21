// The v2.7 L3 OUTBOUND DECISION CARD, down to the half that never needed a window:
// main/session-io's gate PREDICTION and its ONE stream artifact per post attempt, the pure
// reducer's park/deny path for that artifact, and the engine's reshow set.
//
// ⚠ 2026-08-20 (F-228) — THIS FILE USED TO BE FOUR LAYERS. The v1 session WINDOW is deleted and
// renderer/session/** went with it: session-viewmodel.js, session-render.js (makeOutbound),
// session-chrome.js, session.css, session.js and session-preload.js. 27 of the 33 tests here were
// view-model, DOM or renderer-wiring tests and are therefore gone, each replaced in place by a ⚠
// block naming what it pinned and which surface no longer exists. Nothing about main/ was dropped
// — the io section, the reducer section and the reshow pin below are byte-for-byte the guards
// they always were.
//
// The hazards this file still exists to pin:
//   (a) SINGLE ARTIFACT — the outbound event is emitted while the tool_use streams, BEFORE
//       canUseTool decides. sdkRenderEvents must emit exactly ONE, and the generic tool card
//       must stay suppressed behind it.
//   (b) postedThisTurn accounting is untouched (it still drives awaiting_peer), and a DENY's
//       failing tool_result un-counts the post so the turn ends idle.
//   (c) a post gates through the SAME `permission_request` event as any other tool, which is
//       exactly why park, denyPending and the auto-approve drain already cover it — and why a
//       parked pending post fails CLOSED instead of claiming delivery forever.
//   (d) the AXIS B auto-send bypass (messageMode auto_outbound / auto_both) dispatches NOTHING:
//       no card, no dock entry, nothing parked.
//
// Two layers left: main/session-io (required directly — it is electron-free) and the pure
// reducer (source extraction), plus one regex pin on main/session-engine.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const io = require(join(HERE, "..", "main", "session-io.js"));
const profiles = require(join(HERE, "..", "main", "session-profiles.js"));

const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const POST = { op: "post", body: "Shipping the invoice import tonight." };

// ── (a) ONE artifact per post attempt ─────────────────────────────────────────────
//
// ⚠ DELETED 2026-08-20 (F-228) — the VIEW-MODEL half of (a), ~13 tests over
// renderer/session/session-viewmodel.js: that a gating post painted ONE `outbound` item and
// never joined the dock queue; that a non-gating post stayed byte-identical to the v2.6
// delivered bubble; that the full pending -> gate -> resolved -> tool_result sequence still
// left exactly one item; the requestId handover through `outbound_gate` (and its no-ops for an
// unknown id, a missing id and an already-resolved card); the L3 RACE that turned a DELIVERED
// bubble back into a card when auto-approve was flipped off mid-post; the three decisions
// (allow-once / allow-task deliver, deny marks not_sent); markOutboundDecided FAILING CLOSED on
// anything that is not an explicit allow; one card answering only for ITSELF across two pending
// posts; the dock still surfacing a Bash request queued BEHIND a post; and the tool_result belt.
// EVERY ONE of those assertions was a property of `vm.reduceEvent` / `vm.markOutboundDecided` /
// `vm.nextPermission` in renderer/session/session-viewmodel.js, which no longer exists — there
// is no second reducer left to disagree with the one pinned below. The MAIN-side rules those
// tests leaned on (the prediction, the single artifact, the park echo) are all still here.

test("io: postWillGate mirrors canUseTool — gate by default, NOT under a grant or AXIS B", () => {
  const mkSession = (over) => ({ profile: "full", channelId: "ch1", state: { allowForTask: [], messageMode: "ask" }, ...over });
  assert.equal(io.postWillGate(mkSession(), POST), true, "nothing granted -> the card appears");
  // v2.9: the outbound half of the MESSAGE axis replaced the auto-approve toggle here.
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [], messageMode: "auto_outbound" } }), POST), false,
    "auto send outgoing -> no card, the post just goes");
  // FIX F7: the post grant is scoped to the EXACT body, so the key is built from the same
  // call, not hand-written — a body-blind constant no longer suppresses anything.
  const postGrant = profiles.grantKeyFor(CHANNEL_TOOL, POST, "ch1");
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [postGrant], messageMode: "ask" } }), POST), false,
    "the scoped task grant for THIS body -> no card either");
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [postGrant], messageMode: "ask" } }),
    { ...POST, body: "ssh key: AAAA" }), true, "...but a DIFFERENT body is a different decision");
  // A grant taken on another op does NOT suppress the card (FIX F2 scoping).
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [CHANNEL_TOOL + "#op:read"], messageMode: "ask" } }), POST), true);
  // And the TOOL axis can never send a message, not even at `bypass` (THE INVARIANT).
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [], toolMode: "bypass" } }), POST), true);
});

// ── main/session-io: the gate PREDICTION + the suppressed double artifact ──────────

const assistantMsg = (blocks) => ({ type: "assistant", message: { content: blocks } });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });

test("io: sdkRenderEvents marks a gating post PENDING — still ONE event, still no tool card", () => {
  const msg = assistantMsg([toolUse("t1", CHANNEL_TOOL, POST)]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob", () => true);
  assert.equal(evs.length, 1, "one artifact: the generic tool card stays suppressed");
  assert.deepEqual(evs[0].payload, {
    type: "outbound_post", toolUseId: "t1", to: "Bob", text: POST.body,
    pending: true, ownChannel: true,
  });
});

test("io: an auto-approved post carries NO pending marker (the v2.6 payload, exactly)", () => {
  const msg = assistantMsg([toolUse("t1", CHANNEL_TOOL, POST)]);
  for (const predicate of [() => false, undefined, null, "nonsense", () => "yes"]) {
    const evs = io.sdkRenderEvents(msg, "ch1", "Bob", predicate);
    assert.deepEqual(evs[0].payload, { type: "outbound_post", toolUseId: "t1", to: "Bob", text: POST.body },
      "only an explicit true marks a post pending");
  }
});

test("io: the AXIS B auto-send bypass still dispatches NOTHING (no card, no dock)", async () => {
  const s = { profile: "full", channelId: "ch1", state: { allowForTask: [], messageMode: "auto_outbound" }, pendingPermissions: new Map(), pendingNames: new Map() };
  const events = [];
  const res = await io.makeCanUseTool(s, (_s, ev) => events.push(ev))(CHANNEL_TOOL, POST, { requestId: "rA", toolUseID: "tA" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.deepEqual(events, [], "the operator opted out of being asked");
  assert.equal(s.pendingPermissions.size, 0, "and nothing is parked");
});

// ── (c) PARK: a stale card fails closed instead of claiming delivery ───────────────
//
// ⚠ DELETED 2026-08-20 (F-228) — "L3 PARK: the park's fail-closed deny echo resolves a pending
// post to 'Not sent'" pinned the RENDERER end of the same wire: that vm.reduceEvent turned the
// park's `permission_resolved{deny}` into a `not_sent` card. renderer/session/session-viewmodel.js
// is deleted. The MAIN end — that the reducer really emits that echo, keyed on the post's own
// requestId — is the test immediately below and is untouched, so the fail-closed rule still runs.

test("L3 PARK: the reducer really does emit that echo for the post's own requestId", () => {
  // Source-extracted so this can never drift from the shipped reducer. A post gates through
  // the SAME `permission_request` event as any other tool, which is exactly why park,
  // denyPending and the auto-approve drain already cover it — no new event type was added.
  // §2 SPLIT: the pure block now spans session-effects.js + session-reducer.js; the shared
  // helper slices BOTH sentinel pairs and evaluates them as one program.
  const { initialSessionState, sessionReducer } = loadReducer();
  const running = sessionReducer(initialSessionState(), { type: "launched", payload: { type: "init" } }).state;

  // The stream-time artifact records the post for the turn-end status (trap (b), unchanged).
  const posted = sessionReducer(running, {
    type: "outbound_post",
    payload: { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft", pending: true, ownChannel: true },
  }).state;
  assert.equal(posted.postedThisTurn, true, "postedThisTurn still set at stream time");
  assert.deepEqual(posted.postedToolUseIds, ["t1"]);

  // The gate is an ordinary permission_request carrying the card's payload.
  const awaiting = sessionReducer(posted, {
    type: "permission_request", requestId: "r1", name: CHANNEL_TOOL + "#post",
    payload: { type: "outbound_gate", requestId: "r1", toolUseId: "t1" },
  });
  assert.deepEqual(awaiting.state.pendingPermissions, ["r1"], "tracked like any gated tool");
  assert.deepEqual(awaiting.effects[0].payload, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });

  // A park deny-closes it fail-closed AND tells the renderer, which resolves the card.
  const parked = sessionReducer(awaiting.state, { type: "idle_timeout" });
  assert.equal(parked.effects[0].type, "denyPending", "the SDK promise is denied first");
  const echo = parked.effects.find((e) => e.type === "emit" && e.payload.type === "permission_resolved");
  assert.deepEqual(echo.payload, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.deepEqual(parked.state.pendingPermissions, []);

  // (b) A DENY's failing tool_result still un-counts the post, so the turn ends idle and
  // the status pill never claims "Waiting for reply" for a message that never left.
  const corrected = sessionReducer(awaiting.state, {
    type: "tool_result", payload: { type: "tool_result", toolUseId: "t1", ok: false },
  });
  assert.equal(corrected.state.postedThisTurn, false);
  assert.equal(sessionReducer(corrected.state, { type: "result", turnCostUsd: 0 }).state.activity, "idle");

  // An ALLOWED post keeps the count, so the turn still ends awaiting_peer.
  assert.equal(sessionReducer(awaiting.state, { type: "result", turnCostUsd: 0 }).state.activity, "awaiting_peer");
});

// ── (d) the DOM card, and the in-place resolution ─────────────────────────────────
//
// ⚠ DELETED 2026-08-20 (F-228) — the whole DOM layer, ~11 tests plus the ~25-line `makeEl` stub
// document, the `parts()` reader and the `card()` factory wrapper they all shared. Every one of
// them drove `renderer/session/session-render.js › makeOutbound` (or `session-chrome.js ›
// laneClass`) against that stub: the pending card's destination line, drafted body and
// Send / Send-for-this-session / Deny row; each button firing its OWN requestId with the dock's
// verb and LOCKING on the first click; a card main was not yet awaiting hiding its three dead
// buttons (FIX F3); Send and Deny resolving THE SAME NODE in place — hazard (d), which existed
// only because session.js's renderStream created a node once per index and never rebuilt it; an
// auto-approved delivery showing no decision surface; the CROSS-channel fail-suspicious marker;
// `outboundLabel` as the single source of the card's copy; the N-PARTY unaddressed rendering;
// the un-laned full-width recipe; and AUDIT R3(a)'s XSS/id-leak guard over the real makeOutbound
// body (the one that used to fail OPEN on an inverted slice, which is why it used fnOf).
// There is no renderer, no stub document, and no stylesheet left for any of it to read.
//
// ⚠ Two of those did NOT die with the DOM and are pinned elsewhere, deliberately:
//   - the addressee rule itself (who a post is really going to, and the `directChannel` flag
//     that separates an understated blast radius from an overstated one) is main-side and lives
//     in test/session-dm-addressee-truth.test.mjs, which F-228 cut down to that producer half.
//   - the payload that feeds it — `addressed` / `postKind` / `to` coming from the CALL, not the
//     session peer — is pinned in test/session-permission-axes.test.mjs.

// ── wiring guards ──────────────────────────────────────────────────────────────────
//
// ⚠ DELETED 2026-08-20 (F-228) — three renderer wiring pins:
//   - "the controller decides by the card's own requestId" read renderer/session/session.js.
//   - "the preload RETURNS main's own verdict, fail-closed" read session-preload.js. Its rule
//     (coerce to allow-once | allow-task | deny, else DENY) had no other reader: the IPC channel
//     it guarded (`session:permission`) went with session-ipc.js.
//   - "the card's recipe is a full-width sibling of the inbound gate card" read session.css.
// All three files are deleted.
//
// ⚠ KEPT ON PURPOSE (INVARIANTS §14): RESHOW_TYPES is not renderer code. It is a live constant in
// main/session-engine.js, this is its ONLY pin in the suite, and `emit()` still consults it
// against `s.windowHidden` before calling `s.win.show()`. Deleting it with the renderer block it
// sat next to would have taken an unrelated live guard out — the exact failure §14 names.
test("a hidden window RESHOWS for an outbound decision (it needs the operator)", () => {
  const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
  assert.match(ENGINE, /RESHOW_TYPES = new Set\(\['permission_request', 'counterparty', 'inbound_pending', 'outbound_gate'\]\)/);
});
