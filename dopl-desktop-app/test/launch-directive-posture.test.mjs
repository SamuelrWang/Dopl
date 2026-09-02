// T24 (2026-09-01) — A LAUNCH DIRECTIVE MAY ASK FOR A POSTURE AND FOR CHAINING, AND IT MAY
// NEVER WIDEN EITHER.
//
// ── THE INVARIANT THE TICKET RAN INTO ───────────────────────────────────────────────────
// `launch-directives.js`'s header states, in capitals: *"THE DIRECTIVE SUPPLIES GOAL, MODEL AND
// WHICH TEMPLATE, AND NOTHING ELSE… A directive-driven agent is exactly as contained as a
// button-driven one, and nothing an orchestrator writes can widen it."* T24 asked for `tools`,
// `messages` and `chain` to become directive fields, "never wider than the channel's stored
// posture UNLESS the caller is the operator's own account".
//
// ⚠ **THAT CARVE-OUT WAS REFUSED, AND THE REASON IS MEASURABLE RATHER THAN CAUTIOUS.** EVERY
// caller on this lane is the operator's own account — a spawned session calls the MCP server
// with the OPERATOR'S credential (INVARIANTS §11: *"`operator_user_id` NEVER REFUSED A LAUNCHED
// AGENT AND COULD NOT HAVE"*) — so the exception is not narrow, it is the whole set, and taking
// it would hand every agent on the machine the power to launch children wider than their
// operator's room allows. What shipped is the invariant-respecting half: the ASK is admitted and
// CLAMPED to the operator's own stored channel pair.
//
// ── WHAT THIS FILE DRIVES ───────────────────────────────────────────────────────────────
// The clamp, the chain refusal, and the fact that a directive naming NOTHING launches exactly as
// it did before the ticket — which is the case that must not regress, because it is every launch
// anybody has filed so far.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { boot, decidePosts, row, wire, MAIN, WS, DID } from "./_launch-directive-harness.mjs";

const require_ = createRequire(import.meta.url);
const posture = require_(join(MAIN, "launch-posture.js"));

const launchRow = (over = {}) => row({ goal: "do the thing", ...over });
const decided = (h) => decidePosts(h).map((p) => p.body);
/** The `startModes` the lane handed the spawn funnel. */
const handed = (h) => (h.cfg.lastSpec || {}).startModes;

// ── 1. THE PURE RULE ─────────────────────────────────────────────────────────────────────

test("NARROW: a request no wider than the ceiling stands; a wider one lands at the ceiling", () => {
  const T = wire.TOOL_MODES;
  assert.equal(posture.narrowTo("auto", "bypass", T), "auto");
  assert.equal(posture.narrowTo("bypass", "bypass", T), "bypass");
  assert.equal(posture.narrowTo("bypass", "auto", T), "auto");
  assert.equal(posture.narrowTo("bypass", "manual", T), "manual");
  assert.equal(posture.narrowTo("", "bypass", T), "", "nothing asked for is not a request");
});

test("NARROW: an unknown value on EITHER side fails closed, because -1 is narrower than all", () => {
  const T = wire.TOOL_MODES;
  assert.equal(posture.narrowTo("god_mode", "bypass", T), "bypass", "an unknown REQUEST clamps");
  assert.equal(posture.narrowTo("bypass", "god_mode", T), "god_mode", "an unknown CEILING clamps to itself");
});

test("NARROW MESSAGES: the axis is TWO capabilities, not a ladder", () => {
  // 🔒 THE PAIRS AN INDEX COMPARISON GOT WRONG (fixed 2026-09-02). `MESSAGE_MODES` is ordered
  // `ask, auto_inbound, auto_outbound, auto_both`, and `narrowTo` read that as a line — so a
  // request to auto-SEND against an auto-RECEIVE ceiling came back as auto-receive, granting the
  // capability nobody asked for; and auto-receive against an outbound-only ceiling passed
  // straight through because its index was lower. Both moved in the one direction a clamp may not.
  const n = posture.narrowMessageMode;
  assert.equal(n("auto_outbound", "auto_inbound"), "ask", "no capability is jointly permitted");
  assert.equal(n("auto_inbound", "auto_outbound"), "ask", "…and it is symmetric");
  // Everything already right stays right.
  assert.equal(n("auto_both", "auto_inbound"), "auto_inbound");
  assert.equal(n("auto_inbound", "auto_both"), "auto_inbound");
  assert.equal(n("auto_both", "auto_both"), "auto_both");
  assert.equal(n("ask", "auto_both"), "ask");
  assert.equal(n("", "auto_both"), "", "nothing asked for is not a request");
  // ⚠ Unknown on EITHER side clamps to the ceiling — a PROTOTYPE key included, because the bit
  // table is indexed with wire values.
  assert.equal(n("god_mode", "auto_inbound"), "auto_inbound");
  assert.equal(n("constructor", "auto_inbound"), "auto_inbound");
  assert.equal(n("auto_both", "constructor"), "constructor");
});

test("RESOLVE: an axis nobody asked for takes the ceiling — the pre-T24 behaviour, exactly", () => {
  const p = posture.resolvePosture({ tools: "", messages: "" },
    { tools: "bypass", messages: "auto_both" }, wire.TOOL_MODES, wire.MESSAGE_MODES);
  assert.deepEqual(p, { tools: "bypass", messages: "auto_both", clamped: false });
});

test("RESOLVE: `clamped` is true only when a REQUEST was cut, never for an absent one", () => {
  const ceiling = { tools: "auto", messages: "auto_inbound" };
  const cut = posture.resolvePosture({ tools: "bypass", messages: "" }, ceiling,
    wire.TOOL_MODES, wire.MESSAGE_MODES);
  assert.equal(cut.clamped, true);
  const none = posture.resolvePosture({ tools: "", messages: "" }, ceiling,
    wire.TOOL_MODES, wire.MESSAGE_MODES);
  assert.equal(none.clamped, false, "inheriting the ceiling is not being clamped to it");
});

test("CHAIN: only ASK-AND-DENIED refuses; asking nothing inherits the channel setting", () => {
  assert.deepEqual(posture.resolveChain(true, false), { chain: false, refused: true });
  assert.deepEqual(posture.resolveChain(true, true), { chain: true, refused: false });
  assert.deepEqual(posture.resolveChain(null, true), { chain: true, refused: false });
  assert.deepEqual(posture.resolveChain(null, false), { chain: false, refused: false });
});

test("ORDER: the clamp runs BEFORE the windowless floor, which is the contract", () => {
  // ⚠ FLOORING FIRST would let a clamped `ask` come back out as `auto_inbound` and read as
  // though the ceiling had allowed it. Driven with a floor that would betray the wrong order.
  const plan = posture.resolveLaunch({
    requested: { tools: "bypass", messages: "auto_both" },
    ceiling: { tools: "manual", messages: "ask" },
    chainRequested: null, chainAllowed: false,
    floorMessages: (m) => (m === "ask" ? "auto_inbound" : "auto_both"),
    toolOrder: wire.TOOL_MODES, messageOrder: wire.MESSAGE_MODES,
  });
  assert.deepEqual(plan.modes, { tools: "manual", messages: "auto_inbound" });
  assert.equal(plan.clamped, true);
});

// ── 2. THROUGH THE LANE ──────────────────────────────────────────────────────────────────

test("LANE: a directive naming NO posture launches exactly as it did before T24", () => {
  // ⚠ THE REGRESSION CASE, and it is every launch anybody has filed so far. The operator's
  // stored pair, message axis floored.
  const h = boot({ ceiling: { tools: "bypass", messages: "auto_both" } });
  return h.api.handle(launchRow(), WS).then(() => {
    assert.deepEqual(handed(h), { tools: "bypass", messages: "auto_both" });
    // ⚠ "EXACTLY AS BEFORE T24" IS A CLAIM ABOUT THE **SESSION**, NOT ABOUT THE DECIDE BODY. The
    // echo trio joined that body on 2026-09-01 (T24's second half, F-410) and it is reported on
    // EVERY launch, not only a clamped one — otherwise silence would mean two things at once
    // ("an older desktop said nothing" and "a current one agreed with you") and `postureFacts` has
    // one word for it. What must not move is `handed()` above: the posture the session runs at.
    assert.deepEqual(decided(h), [{
      directiveId: DID, status: "launched", agentId: "a1b2c3d4",
      appliedTools: "bypass", appliedMessages: "auto_both", appliedChain: false,
    }]);
  });
});

test("LANE: a NARROWER request is honoured — asking is the point of the ticket", async () => {
  const h = boot({ ceiling: { tools: "bypass", messages: "auto_both" } });
  await h.api.handle(launchRow({ start_tool_mode: "auto", start_message_mode: "auto_inbound" }), WS);
  assert.deepEqual(handed(h), { tools: "auto", messages: "auto_inbound" });
});

test("LANE: a WIDER request is CLAMPED to the operator's stored pair, and still launches", async () => {
  const h = boot({ ceiling: { tools: "accept_edits", messages: "auto_inbound" } });
  await h.api.handle(launchRow({ start_tool_mode: "bypass", start_message_mode: "auto_both" }), WS);
  assert.deepEqual(handed(h), { tools: "accept_edits", messages: "auto_inbound" });
  // ⚠ **AND THE CLAMP IS NOW REPORTED TO THE CALLER, WHICH IS F-410 CLOSED.** The decide echoes
  // the APPLIED pair — `accept_edits`/`auto_inbound` — never the `bypass`/`auto_both` that was
  // asked for. Before 2026-09-01 the clamp existed only in the `diag` line below, so an
  // orchestrator was told `launched` and sized its next instruction for room the agent did not
  // have. Both halves are asserted here: the operator's log AND the caller's answer.
  assert.deepEqual(decided(h), [{
    directiveId: DID, status: "launched", agentId: "a1b2c3d4",
    appliedTools: "accept_edits", appliedMessages: "auto_inbound", appliedChain: false,
  }]);
  assert.ok(h.logged.some((l) => l.includes("CLAMPED")), "and the clamp is recorded, not hidden");
});

test("LANE: an UNSET channel posture is manual/ask, so no directive can widen that room", async () => {
  const h = boot({ ceiling: { tools: "manual", messages: "ask" } });
  await h.api.handle(launchRow({ start_tool_mode: "bypass", start_message_mode: "auto_both" }), WS);
  // ⚠ The tool axis lands at `manual`; the MESSAGE axis is floored to `auto_inbound` afterwards,
  // because a windowless session has no Accept surface and `ask` would strand every inbound turn.
  assert.deepEqual(handed(h), { tools: "manual", messages: "auto_inbound" });
});

// ── 3. THE CHAIN REQUEST ─────────────────────────────────────────────────────────────────

test("CHAIN: asking for it where the channel forbids it REFUSES up front — nothing is launched", async () => {
  const h = boot({ chain: false });
  await h.api.handle(launchRow({ chain: true }), WS);
  assert.equal(h.cfg.lastSpec, undefined, "the funnel is never reached");
  // ⚠ `no-chain`, NOT `no-bridge` (2026-09-02). They were one word, and they are opposite
  // instructions: `no-bridge` means this machine has no context for that channel — go elsewhere —
  // where this means the channel is right and ONE NAMED SETTING is off. An orchestrator that read
  // the first went looking for another route instead of asking for one toggle.
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "refused", refusalReason: "no-chain" }]);
  // ⚠ THE DIAG NAMES THE SETTING AND WHERE IT LIVES. A refusal that does not name its own remedy
  // is what makes an agent re-issue forever — the defect class `session-permissions.js` exists
  // to remove. The agent-facing sentence is the MCP result's; this is the operator's.
  assert.ok(h.logged.some((l) => l.includes("channelAgentChain") && l.includes("Settings tab")));
  assert.equal(posture.CHAIN_SETTING, "channelAgentChain");
});

test("CHAIN: it REFUSES rather than clamping, unlike the posture — and that is the ruling", async () => {
  // ⚠ A clamped POSTURE still produces a working agent under more supervision. A clamped CHAIN
  // produces an agent that hits a bound it was told it did not have, mid-run, after the caller
  // handed it work assuming workers — and the setting is a SPAWN-TIME stamp, so nobody can
  // unblock it afterwards. The asymmetry is asserted, not left to the reader.
  const clamped = boot({ ceiling: { tools: "manual", messages: "ask" } });
  await clamped.api.handle(launchRow({ start_tool_mode: "bypass" }), WS);
  assert.equal(decided(clamped)[0].status, "launched");
  const refused = boot({ chain: false });
  await refused.api.handle(launchRow({ chain: true }), WS);
  assert.equal(decided(refused)[0].status, "refused");
});

test("CHAIN: asking for it where the channel ALLOWS it launches with chaining on", async () => {
  const h = boot({ chain: true });
  await h.api.handle(launchRow({ chain: true }), WS);
  assert.equal(h.cfg.lastSpec.launchChain, true);
  assert.equal(decided(h)[0].status, "launched");
});

test("CHAIN: NOT asking inherits the channel setting, in both directions", async () => {
  const on = boot({ chain: true });
  await on.api.handle(launchRow(), WS);
  assert.equal(on.cfg.lastSpec.launchChain, true);
  const off = boot({ chain: false });
  await off.api.handle(launchRow(), WS);
  assert.equal(off.cfg.lastSpec.launchChain, false);
});

test("CHAIN: the request is a TRI-STATE — and `false` is an ASK, not a silence", () => {
  // ⚠ **THIS CASE SAID "only a literal true is an ask" AND ASSERTED `false -> null`, WHICH WAS
  // THE BUG WRITTEN DOWN AS A RULE (fixed 2026-09-01).** `directiveFrom` flattened a stored
  // `false` into "did not ask", so `chain: false` inherited the channel setting — which may be ON
  // — and could not turn chaining off. Only the values that name NOTHING collapse to `null`.
  // ⚠ THE OTHER HALF OF THE FIX IS `launch-posture.js › resolveChain`, and the two are driven
  // TOGETHER in `test/launch-chain.test.mjs`: each defect made the other unobservable, so a case
  // on one side of the pair — like this one was — cannot close it.
  for (const v of [0, "", null, undefined, {}, "yes"]) {
    assert.equal(wire.directiveFrom(launchRow({ chain: v }), WS).chain, null, String(v));
  }
  assert.equal(wire.directiveFrom(launchRow({ chain: true }), WS).chain, true);
  assert.equal(wire.directiveFrom(launchRow({ chain: false }), WS).chain, false);
  // ⚠ BOTH STRING SPELLINGS, for the same reason `'true'` is accepted: this row may arrive over a
  // transport that stringifies booleans, and a one-sided coercion is how the two halves of a
  // tri-state stop being symmetric.
  assert.equal(wire.directiveFrom(launchRow({ chain: "true" }), WS).chain, true);
  assert.equal(wire.directiveFrom(launchRow({ chain: "false" }), WS).chain, false);
});
