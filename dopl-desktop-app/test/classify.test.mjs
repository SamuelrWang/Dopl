// Truth-table tests for the Channels listener's `classify()` targeting verdict — the
// MESSAGE-FIELD half: the full combination sweep against the spec oracle, the hand-reasoned
// expectations, agent-authored messages (the loop brake), and the first-class task-reply
// verdict.
//
// The LEGACY-THREAD registry cases live in `classify-legacy-threads.test.mjs`; the shared
// harness (source extraction, fixtures, the fresh-scope `build()`) is `_classify-harness.mjs`,
// which states why the three files are three files.
//
// Run: `node --test dopl-desktop-app/test/classify.test.mjs`
//   (or point --test at any glob that includes this file).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  build,
  classify,
  ME,
  U2,
  U3,
  oracle,
  makeMsg,
  makeEntry,
  TO,
  MEMBER_COUNTS,
  IS_MEMBERS,
  AUTHORS,
  AUTHOR_KINDS,
  KINDS,
} from "./_classify-harness.mjs";


test("classify truth table — full combination sweep matches the spec oracle", () => {
  let n = 0;
  for (const to of TO)
    for (const memberCount of MEMBER_COUNTS)
      for (const isMember of IS_MEMBERS)
        for (const author of AUTHORS)
          for (const authorKind of AUTHOR_KINDS)
            for (const kind of KINDS) {
              const m = makeMsg({ to, author, authorKind, kind });
              const entry = makeEntry({ memberCount, isMember });
              const got = classify(m, entry, ME);
              const want = oracle(m, entry, ME);
              assert.equal(
                got,
                want,
                `to=${to} members=${memberCount} isMember=${isMember} author=${author} authorKind=${authorKind} kind=${kind} -> got ${got}, want ${want}`
              );
              n++;
            }
  assert.equal(
    n,
    TO.length *
      MEMBER_COUNTS.length *
      IS_MEMBERS.length *
      AUTHORS.length *
      AUTHOR_KINDS.length *
      KINDS.length
  );
});

// ── Explicit, hand-reasoned expectations (independent of the oracle) ─────────

const foreign = { authorUserId: U2, authorKind: "user", kind: "message", id: "x", seq: 1, body: "hi" };
const to = (tid) => ({ ...foreign, metadata: { to_user_id: tid } });
const plain = { ...foreign, metadata: {} };

test("fail-closed guards -> ignore", () => {
  const entry = makeEntry({ memberCount: 2, isMember: true });
  assert.equal(classify({ ...plain, kind: "task_started" }, entry, ME), "ignore"); // non-message
  assert.equal(classify({ ...plain, authorKind: "system" }, entry, ME), "ignore"); // neither user nor agent
  assert.equal(classify({ ...plain, authorUserId: null }, entry, ME), "ignore"); // no author id
  assert.equal(classify(plain, entry, null), "ignore"); // unknown operator identity
});

test("my own message -> ignore (never self-trigger)", () => {
  const mine = { ...plain, authorUserId: ME };
  assert.equal(classify(mine, makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("addressed to me -> trigger, regardless of member count or membership", () => {
  assert.equal(classify(to(ME), makeEntry({ memberCount: 3, isMember: true }), ME), "trigger");
  assert.equal(classify(to(ME), makeEntry({ memberCount: 3, isMember: false }), ME), "trigger");
});

test("self-addressed noise (to === author) -> ignore", () => {
  assert.equal(classify(to(U2), makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("addressed to a third party -> fyi as a member, ignore as a public non-member", () => {
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

// ⚠ THE IMPLICIT 1:1 TRIGGER IS RETIRED (2026-08-18, wiring plan Phase 3),
// together with the server's DM auto-address it was paired with. The test that
// stood here asserted the opposite:
//
//   test("unaddressed + exactly 2 members + member -> trigger (implicit 1:1)")
//
// It is INVERTED rather than deleted, because "an unaddressed post triggers
// nobody" is now the load-bearing claim and the two-member channel is exactly
// where a regression would reappear.
test("unaddressed + exactly 2 members + member -> FYI, NEVER trigger", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 2, isMember: true }), ME), "fyi");
  // Fail-closed the other way too: a non-member sees nothing.
  assert.equal(classify(plain, makeEntry({ memberCount: 2, isMember: false }), ME), "ignore");
});

// ⚠ THE MEMBER COUNT IS NOT READ AT ALL any more, which is a stronger statement
// than "2 does not trigger" and is the one worth pinning: a future change that
// re-introduces a count-keyed branch has to make one of these rows disagree.
test("the verdict is INDEPENDENT of memberCount for an unaddressed post", () => {
  for (const memberCount of [2, 3, 0, undefined, 99]) {
    assert.equal(
      classify(plain, makeEntry({ memberCount, isMember: true }), ME),
      "fyi",
      `memberCount ${memberCount} changed an unaddressed verdict`
    );
  }
});

// F-170 (2026-08-08) — nothing ever suppressed the implicit trigger, and now
// there is no trigger to suppress. Two assertions once lived here about
// `myNotifyScope: 'none'` turning the implicit two-member trigger into
// 'ignore'; they went with the preference, and the absence-pin that replaced
// them went with the branch. What survives is the same shape of guard aimed at
// what is left: a stale channel entry carrying the removed field must not move
// an unaddressed verdict in EITHER direction.
test("(F-170) a leftover myNotifyScope on the entry changes nothing", () => {
  const base = makeEntry({ memberCount: 2, isMember: true });
  for (const stale of ["none", "addressed", "all"]) {
    assert.equal(
      classify(plain, { ...base, channel: { ...base.channel, myNotifyScope: stale } }, ME),
      "fyi",
      `a stored notify scope of '${stale}' must be ignored`
    );
    assert.equal(
      classify(to(ME), { ...base, channel: { ...base.channel, myNotifyScope: stale } }, ME),
      "trigger",
      `a stored notify scope of '${stale}' must never silence an ADDRESSED request`
    );
  }
});

test("unaddressed + 3+ members -> fyi (unchanged, and now the general case)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
});

test("unaddressed + unknown/invalid memberCount -> fyi (degrades to multi-member)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: undefined, isMember: true }), ME), "fyi");
  assert.equal(classify(plain, makeEntry({ memberCount: 0, isMember: true }), ME), "fyi");
});

test("isMember missing field degrades to member (fyi, not ignore)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 3, isMember: "undefined" }), ME), "fyi");
});

// ── Agent-authored messages (the ask-another-agent fix) ──────────────────────
// One user's agent posts through dopl_channel as author_kind='agent'. Before the
// fix these were dropped by a blanket "user author" guard even when addressed to
// the operator. Now: addressed-to-me triggers; unaddressed is the loop brake.

const agent = { authorUserId: U2, authorKind: "agent", kind: "message", id: "a", seq: 2, body: "hi" };
const agentTo = (tid) => ({ ...agent, metadata: { to_user_id: tid } });
const agentPlain = { ...agent, metadata: {} };

test("(a) agent addressed to me -> trigger (THE BUG: exercises the real MCP path)", () => {
  assert.equal(classify(agentTo(ME), makeEntry({ memberCount: 2, isMember: true }), ME), "trigger");
  // Count/membership don't matter for an explicit address, same as a user.
  assert.equal(classify(agentTo(ME), makeEntry({ memberCount: 3, isMember: false }), ME), "trigger");
});

test("(b) agent addressed to a third party -> fyi (member) / ignore (non-member)", () => {
  assert.equal(classify(agentTo(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(agentTo(U3), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("agent self-addressed (to === author) -> ignore", () => {
  assert.equal(classify(agentTo(U2), makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("(c) agent UNADDRESSED + exactly 2 members -> fyi, NOT trigger (LOOP BRAKE)", () => {
  // ⚠ THIS CASE NO LONGER DISTINGUISHES AGENT FROM USER, and that is the point
  // of the retirement rather than a weakening of it: a USER here used to
  // trigger the implicit 1:1, so the loop brake had to be an agent-only special
  // case. Now NOTHING unaddressed triggers, and the brake is the general rule.
  // Kept because it is the case a regression would reach for first.
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 2, isMember: true }), ME), "fyi");
  // Public non-member still ignores.
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 2, isMember: false }), ME), "ignore");
});

test("(d) agent UNADDRESSED + 3+ members -> fyi (member) / ignore (non-member)", () => {
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("(f) system authorKind -> ignore (neither user nor agent)", () => {
  assert.equal(
    classify({ ...agentPlain, authorKind: "system" }, makeEntry({ memberCount: 2, isMember: true }), ME),
    "ignore"
  );
  // Even addressed-to-me: a non-user/non-agent author never triggers.
  assert.equal(
    classify({ ...agent, authorKind: "system", metadata: { to_user_id: ME } }, makeEntry({ memberCount: 2, isMember: true }), ME),
    "ignore"
  );
});

test("(g) agent + non-message kind -> ignore (kind guard still applies)", () => {
  assert.equal(
    classify({ ...agentPlain, kind: "task_started" }, makeEntry({ memberCount: 2, isMember: true }), ME),
    "ignore"
  );
});

// ── Task-reply verdict (Feature 4, requester side) ───────────────────────────
// A responder-agent reply that belongs to an INTERACTIVE task the operator
// CREATED, addressed back to the operator, is passive news — NOT a fresh spawn.
// The task* keys (taskId / taskMode / taskCreatedBy / taskTarget) are stamped
// SERVER-SIDE (Q4); taskCreatedBy === me separates the REQUESTER (new
// 'task-reply' verdict) from the RESPONDER (unchanged 'trigger'), and taskTarget
// === the author binds the suppression to the RESPONDER specifically — a THIRD
// member posting into my task (author !== taskTarget) still 'trigger's. Autonomous
// mode and old messages that carry no taskMode fall through to today's verdict,
// and the kind guard still wins over everything (a task_* marker stays 'ignore').
//
// These messages carry metadata the full-sweep oracle above never builds, so
// they exercise the new branch without disturbing the exhaustive sweep. The
// task's target (responder) is U2 — the same id that authors the reply.
const taskReply = (over = {}) => ({
  authorUserId: U2, // responder's agent
  authorKind: "agent",
  kind: "message",
  id: "t",
  seq: 3,
  body: "here is the answer",
  metadata: { to_user_id: ME, taskId: "task-123", taskMode: "interactive", taskCreatedBy: ME, taskTarget: U2, ...over },
});

test("(task-a) interactive task I created, reply addressed to me -> task-reply", () => {
  assert.equal(classify(taskReply(), makeEntry({ memberCount: 2, isMember: true }), ME), "task-reply");
  // Explicitly addressed, so member count / membership do not matter.
  assert.equal(classify(taskReply(), makeEntry({ memberCount: 3, isMember: true }), ME), "task-reply");
  assert.equal(classify(taskReply(), makeEntry({ memberCount: 5, isMember: false }), ME), "task-reply");
});

test("(task-b) same task but created by someone else -> trigger (responder side, unchanged)", () => {
  assert.equal(
    classify(taskReply({ taskCreatedBy: U3 }), makeEntry({ memberCount: 2, isMember: true }), ME),
    "trigger"
  );
});

test("(task-c) interactive but autonomous mode -> trigger (never task-reply)", () => {
  assert.equal(
    classify(taskReply({ taskMode: "autonomous" }), makeEntry({ memberCount: 2, isMember: true }), ME),
    "trigger"
  );
});

test("(task-d) old message with no taskMode -> trigger (falls through unchanged)", () => {
  const m = {
    authorUserId: U2,
    authorKind: "agent",
    kind: "message",
    id: "t",
    seq: 3,
    body: "x",
    metadata: { to_user_id: ME, taskId: "task-123", taskCreatedBy: ME },
  };
  assert.equal(classify(m, makeEntry({ memberCount: 2, isMember: true }), ME), "trigger");
});

test("(task-e) interactive task metadata but kind task_finished -> ignore (kind guard wins)", () => {
  const finished = { ...taskReply(), kind: "task_finished" };
  assert.equal(classify(finished, makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("(task-f) interactive + mine but NOT addressed to me -> not task-reply", () => {
  // to_user_id addresses a third party: the reply is not for this operator, so
  // the task-reply branch (which requires to === me) must not fire. Falls through
  // to the addressed-to-third-party rule -> fyi (member).
  assert.equal(
    classify(taskReply({ to_user_id: U3 }), makeEntry({ memberCount: 3, isMember: true }), ME),
    "fyi"
  );
});

test("(task-g) interactive + mine + to-me but author !== taskTarget -> trigger", () => {
  // A THIRD member posts into my task: the message resolves to the task (so the
  // server stamps taskTarget = the real responder U2), but the AUTHOR is U3, not
  // the target. The suppression must NOT fire — it would silently swallow a
  // stranger's post. Falls through to the addressed-to-me rule -> trigger.
  const fromThird = { ...taskReply(), authorUserId: U3 };
  assert.equal(classify(fromThird, makeEntry({ memberCount: 3, isMember: true }), ME), "trigger");
  // The same author with a matching taskTarget (U3) IS the responder -> task-reply.
  assert.equal(
    classify({ ...taskReply({ taskTarget: U3 }), authorUserId: U3 }, makeEntry({ memberCount: 3, isMember: true }), ME),
    "task-reply"
  );
});
