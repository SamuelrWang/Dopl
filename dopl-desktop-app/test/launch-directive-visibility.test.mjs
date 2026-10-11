// F-3201 — WHAT A NON-DECISION SAYS, AND TO WHOM. Its own file because
// `launch-directives.test.mjs` sits at 477 of the §2 500-line cap; same shared harness, so both
// suites test one program.
//
// ⚠ THE DEFECT THESE PIN WAS A PROMISE IN A COMMENT. `launch-directives.js`'s header said the
// funnel was "SILENT on every non-decision … the row expires where the orchestrator sees it".
// Nothing writes `expired` (239 prod rows, zero of them), the status is computed at read time
// only, and the MCP launch op abandons its 30s hold 90 seconds before a 120s TTL can elapse — so
// the launcher heard `pending retry=no` once about a row that was already dead, and never again.
// Two rows died that way on 2026-10-10: 18b15b76 "Credit Card Fix" and accdb17f "Tool Gate Probe",
// both `pending`, never claimed, no trace on either side.
//
// Two rules, and the split between them is the safety argument: a non-decision still writes
// NOTHING to the server (the claim is the authorisation — §6), but it now SAYS WHY locally, and
// the two reasons the OPERATOR can act on raise their banner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, row, claimPosts, decidePosts, wire, DID, CH, WS, OTHER } from "./_launch-directive-harness.mjs";

const said = (h, needle) => h.logged.filter((l) => l.includes(needle));
const codes = (h) => said(h, "NOT acted on");

// ── every exit is coded ─────────────────────────────────────────────────────────

test("the launch lane being OFF is coded, and tells the operator ONCE", async () => {
  const h = boot({ enabled: false });
  await h.api.handle(row(), WS);
  assert.equal(claimPosts(h).length, 0, "an unarmed lane writes nothing — the toggle is the consent");
  assert.equal(codes(h).length, 1);
  assert.match(codes(h)[0], /lane-off/);
  assert.match(codes(h)[0], new RegExp(DID.slice(0, 8)), "the row id, so a log reader can match it");
  assert.equal(h.notices.length, 1, "the operator is the only one who can fix this");
  assert.equal(h.notices[0].eventId, "decision_failed");
  assert.match(h.notices[0].spec.body, /launch lane is off/);

  // ⚠ ONCE PER ROW, NOT ONCE PER DELIVERY. Realtime and the backstop poll both deliver the same
  // row inside one TTL, and two banners for one request is how a safety notice gets muted.
  await h.api.handle(row(), WS);
  assert.equal(h.notices.length, 1, "the second delivery of the same row is silent");
});

test("a lane-off row is still never written to: the operator is told, the server is not", async () => {
  const h = boot({ enabled: false });
  await h.api.handle(row(), WS);
  assert.deepEqual(h.posts, [], "no claim, no decide — a machine that declined has no verdict to write");
});

test("another operator's row on a shared workspace stays ORDINARY: no code, no banner", async () => {
  const h = boot();
  await h.api.handle(row({ operator_user_id: OTHER }), WS);
  assert.equal(codes(h).length, 0, "someone else's directive is not a drop");
  assert.equal(h.notices.length, 0);
});

test("a duplicate delivery of our own row stays ORDINARY", async () => {
  const h = boot();
  await h.api.handle(row(), WS);
  const before = codes(h).length;
  await h.api.handle(row(), WS);
  assert.equal(codes(h).length, before, "the dedupe ledger is not a failure to report");
  assert.equal(h.notices.length, 0);
});

test("a claim this machine lost is coded, and points at the line that says WHICH", async () => {
  // 409 is the designed outcome for every machine but one (F-286): ordinary, so no banner.
  const h = boot({ claimAnswer: { ok: false, status: 409 } });
  await h.api.handle(row(), WS);
  assert.match(codes(h)[0], /claim-lost/);
  assert.equal(said(h, "claim lost").length, 1, "`claim` already logged which of the two it was");
  assert.equal(h.notices.length, 0, "losing a race is not the operator's problem");
});

test("an unresolved operator identity is coded rather than silent", async () => {
  const h = boot({ user: null });
  await h.api.handle(row(), WS);
  assert.match(codes(h)[0], /no-identity/);
  assert.equal(claimPosts(h).length, 0);
});

// ── the lost decision: the agent is RUNNING and the row says nobody decided ─────

// ⚠ THE WORST SHAPE IN THE FEATURE, AND IT USED TO BE ONE DIAG LINE. Observed
// 2026-10-11T09:23:34Z: `launch-directive 3edc3195 launched agent jqxz7mr9 — DECISION NOT
// RECORDED`. Row 3edc3195 stayed `claimed` with a null agent_id while jqxz7mr9 worked for hours.
// The launcher's picture and the machine's were opposites, and nothing reconciled them.
test("decide is RETRIED with backoff before anything is called lost", async () => {
  let n = 0;
  const h = boot({
    decideAnswer: () => { n += 1; return { ok: n >= 3, status: n >= 3 ? 200 : 503 }; },
  });
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h).length, 3, "two failures then a success, inside one TTL");
  assert.equal(said(h, "recorded on attempt 3").length, 1);
  assert.equal(h.drops.length, 0, "a decision that landed is not a lost one");
  assert.equal(h.notices.length, 0);
});

test("a 409 on decide is SUCCESS, not a retry: the CAS means somebody already recorded it", async () => {
  const h = boot({ decideAnswer: () => ({ ok: false, status: 409 }) });
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h).length, 1, "retrying an already-decided row would be competing with ourselves");
  assert.equal(said(h, "already decided").length, 1);
  assert.equal(h.drops.length, 0);
});

test("a 4xx on decide is FINAL: three identical rejections are not worth three round trips", async () => {
  const h = boot({ decideAnswer: () => ({ ok: false, status: 400 }) });
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h).length, 1);
  assert.match(said(h, "decide REFUSED")[0], /will not improve/);
});

test("a decision lost for a RUNNING agent posts the orphan and sounds the operator's banner", async () => {
  const h = boot({ decideAnswer: () => ({ ok: false, status: 0, error: "network" }) });
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h).length, 3, "it exhausted the retries first");

  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].eventId, "decision_failed", "locked on, sounds, bounces the dock");
  assert.match(h.notices[0].spec.body, /a1b2c3d4/, "the agent id, so the operator can address it");

  assert.equal(h.drops.length, 1, "and a durable record in the room the launcher reads");
  const d = h.drops[0];
  assert.equal(d.entry.channel.id, CH);
  assert.equal(d.entry.workspaceId, WS);
  assert.match(d.text, /@agent-a1b2c3d4 IS RUNNING/);
  // ⚠ THE ADVICE IS THE POINT. Relaunching is the obvious reaction and it is the wrong one: it
  // puts two agents on one task, which is the failure the orchestrator hit on 10-10.
  assert.match(d.text, /Address this agent rather than asking again/);
  assert.match(d.text, /second request starts a second agent/);
  assert.equal(d.opts.clientMsgId, `lost-decision-${DID}`, "keyed on the row, so it cannot double-post");
  assert.match(d.opts.summary, /not recorded/);
});

test("a lost REFUSAL stays local: nobody is waiting on an agent that never started", async () => {
  const h = boot({
    watched: null, // -> `no-bridge`, so the outcome is a refusal with no agentId
    decideAnswer: () => ({ ok: false, status: 0, error: "network" }),
  });
  await h.api.handle(row(), WS);
  assert.equal(h.drops.length, 0, "no running agent means no orphan to name in the room");
  assert.equal(h.notices.length, 1, "but the operator is still told the answer did not save");
  assert.match(h.notices[0].spec.body, /could not record the answer/);
});

test("the orphan report never throws, even when its own post fails", async () => {
  const h = boot({
    dropPostOk: false,
    decideAnswer: () => ({ ok: false, status: 500 }),
  });
  await h.api.handle(row(), WS);
  assert.equal(said(h, "POST FAILED TOO").length, 1, "said plainly, rather than swallowed");
  assert.equal(h.notices.length, 1, "the banner already went up before the post was attempted");
});
