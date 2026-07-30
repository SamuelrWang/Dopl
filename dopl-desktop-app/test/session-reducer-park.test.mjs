// Tests for the v1.7.4 P1 park transitions in the pure session reducer
// (main/session-reducer.js). Split out of session-reducer.test.mjs to keep BOTH files
// under the §2 500-line cap. SAME source-extraction idiom: slice the reducer's
// BEGIN/END sentinel block and evaluate it verbatim, so these can never drift from what
// ships. Covers: idle PARKS (never settles), the deny-close of pending permissions on
// park, park idempotency, and the two — and only two — lazy-resume triggers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-reducer.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-REDUCER";
const END = "// ─── END SESSION-REDUCER";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.ok(from !== -1 && to > from, "session-reducer sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

const { initialSessionState, sessionReducer } = new Function(
  `${BLOCK}\n return { initialSessionState, sessionReducer };`
)();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const effTypes = (effects) => effects.map((e) => e.type);
const findEff = (effects, type) => effects.find((e) => e.type === type);

// ── idle PARKS (does not end) ─────────────────────────────────────────────────────

test("idle_timeout PARKS the session — no settle/destroy/delete, sdkSessionId retained", () => {
  const s = running();
  const r = sessionReducer(s, { type: "idle_timeout" });
  // P1: NOT ended, NOT settled. The park effect set tears the query down but keeps the
  // session object + window alive (no `settle`, so the engine never destroys/deletes it).
  assert.equal(r.state.phase, "parked");
  assert.equal(r.state.parked, true);
  assert.equal(r.state.turns, s.turns, "turn count is preserved across a park");
  assert.deepEqual(effTypes(r.effects), ["denyPending", "abortQuery", "clearIdle", "persist", "emit", "emit"]);
  assert.ok(!r.effects.some((e) => e.type === "settle"), "park NEVER settles (no destroy/delete)");
  assert.ok(!r.effects.some((e) => e.type === "scheduleIdle"), "park NEVER re-arms the idle timer");
  assert.equal(findEff(r.effects, "persist").phase, "parked");
  const status = r.effects.find((e) => e.type === "emit" && e.payload.type === "status");
  assert.deepEqual(status.payload, { type: "status", phase: "parked" });
  assert.ok(r.effects.some((e) => e.type === "emit" && e.payload.type === "paused"), "emits the inline paused note");
});

test("idle_timeout clears any awaited permission (denyPending) and empties pendingPermissions", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1", "r2"] };
  const r = sessionReducer(s, { type: "idle_timeout" });
  assert.equal(r.state.phase, "parked");
  assert.deepEqual(r.state.pendingPermissions, [], "no awaited permission survives a park");
  assert.equal(effTypes(r.effects)[0], "denyPending", "denyPending runs BEFORE abort (fail closed)");
  // FIX #6: park also clears the RENDERER's dock — a permission_resolved{deny} per pending id
  // so a query-less parked session never shows a live-looking (clickable, lying) prompt.
  const resolved = r.effects.filter((e) => e.type === "emit" && e.payload.type === "permission_resolved");
  assert.deepEqual(resolved.map((e) => e.payload), [
    { type: "permission_resolved", requestId: "r1", decision: "deny" },
    { type: "permission_resolved", requestId: "r2", decision: "deny" },
  ]);
});

// ── FIX F6 (v2.7): the per-turn POST counters must not survive a park either ─────────
// A park deny-closes every awaited card, so a gated post reads "Not sent" — but
// postedThisTurn / postedToolUseIds stayed set, and the pill's turn-end transition would then
// pick `awaiting_peer` ("Waiting for reply") right beside that stopped draft.

test("FIX F6: parking clears postedThisTurn + postedToolUseIds (no 'Waiting for reply' on a stopped post)", () => {
  const posted = sessionReducer(running(), {
    type: "outbound_post",
    payload: { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft", pending: true, ownChannel: true },
  }).state;
  assert.equal(posted.postedThisTurn, true, "set at stream time, as before");
  assert.deepEqual(posted.postedToolUseIds, ["t1"]);

  const r = sessionReducer({ ...posted, pendingPermissions: ["r1"] }, { type: "idle_timeout" });
  assert.equal(r.state.parked, true);
  assert.equal(r.state.postedThisTurn, false, "nothing is awaiting a reply — the post was denied");
  assert.deepEqual(r.state.postedToolUseIds, []);
  // The park still deny-closes the card itself, which is what makes the counters wrong to keep.
  const echo = r.effects.find((e) => e.type === "emit" && e.payload.type === "permission_resolved");
  assert.deepEqual(echo.payload, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  // And the effect SET is unchanged by this fix (state-only change).
  assert.deepEqual(effTypes(r.effects), ["denyPending", "abortQuery", "clearIdle", "persist", "emit", "emit", "emit"]);
});

test("FIX F6: a woken session still counts a NEW post normally", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const woken = sessionReducer(parked, { type: "steer", text: "carry on" }).state;
  assert.equal(woken.parked, false);
  const again = sessionReducer(woken, {
    type: "outbound_post", payload: { type: "outbound_post", toolUseId: "t2", to: "David", text: "next" },
  }).state;
  assert.equal(again.postedThisTurn, true, "the park reset the counters, it did not disable them");
  assert.deepEqual(again.postedToolUseIds, ["t2"]);
});

// ── FIX #3: autoApprove must not survive an idle park ───────────────────────────────

test("FIX #3: parking resets autoApprove OFF so a lazy resume never runs auto-armed", () => {
  const s = { ...running(), autoApprove: true };
  const r = sessionReducer(s, { type: "idle_timeout" });
  assert.equal(r.state.parked, true);
  assert.equal(r.state.autoApprove, false, "auto-approve is disarmed while the operator is away");
});

// ── FIX #5: a parked session is INERT to buffered SDK messages ──────────────────────

test("FIX #5: a late `result` while parked runs NO effects (no cap end, no idle re-arm)", () => {
  const parked = sessionReducer(running({ turnCap: 1 }), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "result", turnCostUsd: 5 });
  assert.equal(r.state, parked, "state is unchanged");
  assert.deepEqual(r.effects, [], "a drained result must not run endEffects or scheduleIdle on a parked session");
});

test("FIX #5: late render pass-throughs while parked are inert (no emit)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  for (const type of ["assistant", "tool_use", "tool_result", "outbound_post"]) {
    const r = sessionReducer(parked, { type, payload: { type, x: 1 } });
    assert.deepEqual(r.effects, [], `${type} is inert while parked`);
    assert.equal(r.state, parked);
  }
});

test("FIX #5: a late permission_request while parked stashes NO resolver (inert)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "permission_request", requestId: "rZ", name: "Bash", payload: {} });
  assert.deepEqual(r.effects, [], "no emit, no pending stash on a parked session");
  assert.deepEqual(r.state.pendingPermissions, [], "the resolver is never tracked");
  assert.equal(r.state.phase, "parked");
});

// ── FIX #6: a stale dock click on a parked session must not resume it ────────────────

test("FIX #6: permission_decision while parked keeps phase parked (only steer/inbound resume)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  assert.equal(r.state.phase, "parked", "a stale dock click never flips a parked session to running");
  assert.equal(r.state.activity, "parked");
  assert.ok(!r.effects.some((e) => e.type === "resumeQuery"), "no resume from a dock click");
});

// ── FIX #1a: a crash on a parked session is inert (park aborted the query, not settled) ─

test("FIX #1a: a `crash` while parked is a NO-OP (a stray non-abort rejection can't settle it)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "crash" });
  assert.equal(r.state, parked, "the parked session survives — no settle/destroy");
  assert.deepEqual(r.effects, [], "no settle, no interrupted lifecycle, no error emit");
  assert.equal(r.state.phase, "parked");
});

test("FIX #1a: a genuine crash on a RESUMED (not parked) session still settles interrupted", () => {
  // Wake the parked session (steer clears the parked flag) — a real crash now settles.
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const woke = sessionReducer(parked, { type: "steer", text: "go" }).state;
  assert.equal(woke.parked, false);
  const r = sessionReducer(woke, { type: "crash" });
  assert.equal(r.state.phase, "ended");
  assert.ok(r.effects.some((e) => e.type === "settle" && e.outcome === "interrupted"));
});

test("a parked session ignores a stale idle_timeout (idempotent, no double-park)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "idle_timeout" });
  assert.equal(r.state, parked);
  assert.deepEqual(r.effects, []);
});

// ── the two lazy-resume triggers ──────────────────────────────────────────────────

// v2.5 D1: an inbound turn only wakes a parked session when it is AUTO-ACCEPTED (the
// per-session toggle or the standing task grant). Without that opt-in the reply is held
// and the session stays parked — the two cases below. NOTE: `idle_timeout` resets
// autoApprove OFF (FIX #3), so the standing task grant (which survives a park) is what
// keeps a counterparty-driven lazy resume possible while the operator is away.
test("LAZY RESUME (a): an AUTO-ACCEPTED inbound turn wakes a parked session (resumeQuery FIRST)", () => {
  const parked = sessionReducer(running({ mode: "autonomous" }), { type: "idle_timeout" }).state;
  assert.equal(parked.parked, true);
  assert.equal(parked.autoApprove, false, "FIX #3: the toggle is disarmed by the park");
  const granted = { ...parked, inboundForTask: true }; // "Accept for this task" survives a park
  const r = sessionReducer(granted, { type: "inbound_arrived", message: "back", authorName: "Bob" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.parked, false, "the wake clears the parked flag");
  // resumeQuery MUST precede pushInbound so the fresh push iterator exists first.
  assert.equal(effTypes(r.effects)[0], "resumeQuery");
  const pushIdx = effTypes(r.effects).indexOf("pushInbound");
  assert.ok(pushIdx > 0, "pushInbound follows the resume");
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "back", authorName: "Bob" });
});

test("LAZY RESUME (b): operator steer wakes a parked session (resumeQuery, no interrupt)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "steer", text: "keep going", priority: "now" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.parked, false);
  // A parked query has nothing live to interrupt, so a priority:'now' wake skips it.
  assert.deepEqual(effTypes(r.effects), ["resumeQuery", "pushTurn", "emit"]);
  assert.ok(!r.effects.some((e) => e.type === "interruptQuery"), "no interrupt while waking");
  const status = r.effects.find((e) => e.type === "emit" && e.payload.type === "status");
  assert.deepEqual(status.payload, { type: "status", phase: "running", activity: "working" });
});

test("interactive park holds an inbound reply (stays parked); the RELEASE wakes it", () => {
  const parked = sessionReducer(running({ mode: "interactive" }), { type: "idle_timeout" }).state;
  // A held reply does not wake a parked query — it stays parked, phase awaiting_inbound.
  const held = sessionReducer(parked, { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  assert.equal(held.state.phase, "awaiting_inbound");
  assert.equal(held.state.parked, true, "still parked until the operator releases");
  assert.ok(!held.effects.some((e) => e.type === "resumeQuery"), "holding a reply does not resume");
  // Releasing it is the wake trigger.
  const released = sessionReducer(held.state, { type: "inbound_released", message: "hi", authorName: "Bob" });
  assert.equal(released.state.phase, "running");
  assert.equal(released.state.parked, false);
  assert.equal(effTypes(released.effects)[0], "resumeQuery");
});

test("a live (not parked) inbound / steer / release NEVER emits resumeQuery", () => {
  const auto = sessionReducer(running({ mode: "autonomous" }), { type: "inbound_arrived", message: "x", authorName: "B" });
  assert.ok(!auto.effects.some((e) => e.type === "resumeQuery"));
  const steer = sessionReducer(running(), { type: "steer", text: "x" });
  assert.ok(!steer.effects.some((e) => e.type === "resumeQuery"));
  const rel = sessionReducer(
    { ...running({ mode: "interactive" }), phase: "awaiting_inbound", hasPendingInbound: true },
    { type: "inbound_released", message: "go", authorName: "B" }
  );
  assert.ok(!rel.effects.some((e) => e.type === "resumeQuery"));
});
