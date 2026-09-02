// THE APPLIED-POSTURE ECHO — what the machine tells the orchestrator it actually did (2026-09-01,
// T24's second half; F-410).
//
// THE FINDING THIS CLOSES, verbatim: *a CLAMPED posture directive has no way to tell the caller it
// was clamped.* An orchestrator could ask for `bypass`/`auto_both`, get an agent running at
// `auto`/`auto_inbound` because that is the operator's ceiling, and be told only `launched` — so it
// sized its next instruction for room the agent did not have. The `applied_*` columns existed with
// no writer; `launch-directive-spawn.js › spawn` and `launch-directive-wire.js › decideBody` are
// the writer.
//
// ⚠ **EVERY CASE ASSERTS THE DECIDE BODY, WHICH IS THE OBJECT THAT CROSSES THE PROCESS BOUNDARY**
// (INVARIANTS §14), not `resolveLaunch`'s return value. `launch-posture.js` computing the right
// pair proves nothing about whether the pair is REPORTED, and the whole finding was about a value
// that existed and never travelled.
//
// ⚠ THE HARNESS IS THE SHARED ONE. `spawn` is the real module, evaluated through the same stub
// `require`, so the clamp, the windowless floor and the chain rule are the shipped ones.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, row, wire, CH, WS, decidePosts } from "./_launch-directive-harness.mjs";

/** One launch directive through the real lane; answers the decide body that was POSTed. */
async function decidedBody(over = {}, cfg = {}) {
  const h = boot(cfg);
  await h.api.handle(row({ channel_id: CH, ...over }), WS);
  const posts = decidePosts(h);
  assert.equal(posts.length, 1, "exactly one decision is written per claimed directive");
  return posts[0].body;
}

test("a launch REPORTS the pair it applied, not the pair it was asked for", async () => {
  // ⚠ THE CLAMP CASE, AND IT IS THE WHOLE POINT. The ceiling is `auto`/`ask`; the directive asks
  // for the widest pair on both axes. Reporting the REQUEST here would be right whenever nothing
  // was clamped and confidently wrong exactly when it mattered.
  const body = await decidedBody(
    { start_tool_mode: "bypass", start_message_mode: "auto_both" },
    { ceiling: { tools: "auto", messages: "ask" } },
  );
  assert.equal(body.status, "launched");
  assert.equal(body.appliedTools, "auto", "clamped to the operator's ceiling, and SAID so");
  assert.notEqual(body.appliedTools, "bypass", "the REQUEST must never be echoed back");
  // ⚠ CLAMP, THEN FLOOR: `ask` is clamped to, then the windowless floor lifts it to
  // `auto_inbound`. The echo reports what the SESSION got, which is the floored value — a report
  // of the clamp alone would name a posture no session is running at.
  assert.equal(body.appliedMessages, "auto_inbound");
});

test("a launch that asked for NOTHING still reports — silence must keep meaning 'not reported'", async () => {
  // ⚠ THE CASE A LAZY IMPLEMENTATION SKIPS. If the machine reported only when it clamped, an
  // absent echo would mean two different things — "an older desktop said nothing" and "a current
  // desktop agreed with you" — and `postureFacts` has one word for it.
  const body = await decidedBody({}, { ceiling: { tools: "accept_edits", messages: "auto_both" } });
  assert.equal(body.appliedTools, "accept_edits");
  assert.equal(body.appliedMessages, "auto_both");
});

test("the CHAIN echo is a real boolean, and `false` is a REPORT rather than a silence", async () => {
  // ⚠ `false` HERE IS THE FACT THAT STOPS AN ORCHESTRATOR PLANNING FOR WORKERS. A truthiness test
  // in `decideBody` would drop the key, the column would be NULL, and the render would say
  // "not reported" about something the machine knows for certain.
  const off = await decidedBody({}, { chain: false });
  assert.equal(off.appliedChain, false);
  assert.ok("appliedChain" in off, "the key is PRESENT — dropping it would report ignorance");
  const on = await decidedBody({}, { chain: true });
  assert.equal(on.appliedChain, true);
});

test("an explicit `chain: false` is reported as false even where the channel allows chaining", async () => {
  // The T24 echo and the tri-state fix, met: the row asked for OFF, the room says ON, the session
  // runs OFF, and the orchestrator is TOLD it runs off.
  const body = await decidedBody({ chain: false }, { chain: true });
  assert.equal(body.appliedChain, false);
});

test("⚠ a REFUSAL carries no echo — nothing was applied, so nothing may be reported", async () => {
  // ⚠ AN ECHO BESIDE A REFUSAL WOULD BE A CLAIM ABOUT A SESSION THAT DOES NOT EXIST. `no-chain`
  // here is the chain refusal, which happens BEFORE any spawn.
  const body = await decidedBody({ chain: true }, { chain: false });
  assert.equal(body.status, "refused");
  assert.equal(body.refusalReason, "no-chain");
  for (const k of ["appliedTools", "appliedMessages", "appliedChain"]) {
    assert.ok(!(k in body), `${k} must not appear on a refusal`);
  }
});

test("⚠ a RENAME's `done` carries no echo — that verb resolves no posture at all", async () => {
  const h = boot({ live: [{ agentId: "a1b2c3d4", channelId: CH, taskId: "" }] });
  await h.api.handle(
    row({ kind: "rename", channel_id: CH, target_agent_id: "a1b2c3d4", target_name: "Auditor" }),
    WS,
  );
  const body = decidePosts(h)[0].body;
  assert.equal(body.status, "done");
  for (const k of ["appliedTools", "appliedMessages", "appliedChain"]) {
    assert.ok(!(k in body), `${k} must not appear on a ${body.status}`);
  }
});

test("⚠ a CLAMPED set_agent_mode's `done` DOES carry the echo — it is the one that settles one", async () => {
  // ⚠ THE DEFECT THIS CLOSES (2026-09-02). `directive-agent-ops.js › setAgentMode` returned a
  // bare `{ done: true }`, so a request narrowed to the channel's ceiling was answered `taken`
  // with the clamp visible only in this machine's own log — the very gap T24's echo closed on
  // the LAUNCH lane, left open on the lane whose whole job is moving a posture.
  const h = boot({
    live: [{ agentId: "a1b2c3d4", channelId: CH, taskId: "" }],
    ceiling: { tools: "auto", messages: "auto_inbound" },
  });
  await h.api.handle(
    row({
      kind: "set_agent_mode", channel_id: CH, target_agent_id: "a1b2c3d4",
      target_tool_mode: "bypass", target_message_mode: "auto_both",
    }),
    WS,
  );
  const body = decidePosts(h)[0].body;
  assert.equal(body.status, "done");
  assert.equal(body.appliedTools, "auto", "clamped to the ceiling, and SAID so");
  assert.equal(body.appliedMessages, "auto_inbound");
  // ⚠ NOT the request echoed back — that is the reading this whole trio exists to refuse.
  assert.notEqual(body.appliedTools, "bypass");
  // ⚠ AND NO `appliedChain`: a re-posture starts nothing, so it decides no chaining.
  assert.ok(!("appliedChain" in body));
});

test("⚠ an axis the set_agent_mode LEFT ALONE stays absent, never echoed as the ceiling", async () => {
  const h = boot({
    live: [{ agentId: "a1b2c3d4", channelId: CH, taskId: "" }],
    ceiling: { tools: "auto", messages: "auto_inbound" },
  });
  await h.api.handle(
    row({
      kind: "set_agent_mode", channel_id: CH, target_agent_id: "a1b2c3d4",
      target_tool_mode: "accept_edits",
    }),
    WS,
  );
  const body = decidePosts(h)[0].body;
  assert.equal(body.appliedTools, "accept_edits");
  assert.ok(!("appliedMessages" in body),
    "an axis nobody asked about must not be reported as moved");
});

// ── THE WIRE'S OWN NARROWING, DRIVEN DIRECTLY ────────────────────────────────────

test("decideBody NARROWS the echo to the frozen enums — a mode this build never heard of is dropped", () => {
  // ⚠ THE FAILURE IT PREVENTS IS A DECIDE REFUSED **AT REST**. A value outside the enum passes
  // this machine, passes zod only if the enum there drifted, and lands on the column CHECK — so a
  // launch that really happened would be recorded as nothing at all.
  const body = wire.decideBody("d1", {
    agentId: "a1b2c3d4", appliedTools: "yolo", appliedMessages: "telepathy", appliedChain: "yes",
  });
  assert.deepEqual(body, { directiveId: "d1", status: "launched", agentId: "a1b2c3d4" });
});

test("decideBody omits an ABSENT echo rather than sending null — that is the older-desktop shape", () => {
  // ⚠ INVARIANTS §13: an older peer is supported. Such a machine posts exactly this body, the
  // three columns stay NULL, and `channel-ops-launch.ts › postureFacts` says `not reported`.
  assert.deepEqual(wire.decideBody("d1", { agentId: "a1b2c3d4" }),
    { directiveId: "d1", status: "launched", agentId: "a1b2c3d4" });
});

test("REQUEST_KEYS names every key the decide really sends", () => {
  // ⚠ A LIST THAT OMITS A FIELD THAT REALLY CROSSES IS WORSE THAN NO LIST. Driven against the
  // real builder rather than eyeballed: every key `decideBody` can emit must be declared.
  const emitted = new Set([
    ...Object.keys(wire.decideBody("d1", {
      agentId: "a1b2c3d4", appliedTools: "auto", appliedMessages: "ask", appliedChain: true,
    })),
    ...Object.keys(wire.decideBody("d1", { refused: "cap" })),
    ...Object.keys(wire.decideBody("d1", {
      done: true, appliedTools: "auto", appliedMessages: "ask",
    })),
  ]);
  for (const k of emitted) {
    assert.ok(wire.REQUEST_KEYS.decide.indexOf(k) !== -1, `REQUEST_KEYS.decide is missing ${k}`);
  }
});
