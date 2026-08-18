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
  mentionsMe,
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
  MENTIONS,
  INTENTS,
} from "./_classify-harness.mjs";


// The sweep is the product of its axes — 4608 cases when this line was written (2026-08-18,
// wiring plan Phase 7, which added the MENTIONS and INTENTS axes). ⚠ THE PRODUCT IS ASSERTED,
// NOT THE LITERAL: a number in a comment is a future wrong answer, and an axis somebody adds
// without adding a factor here would otherwise pass silently.
test("classify truth table — full combination sweep matches the spec oracle", () => {
  let n = 0;
  for (const to of TO)
    for (const memberCount of MEMBER_COUNTS)
      for (const isMember of IS_MEMBERS)
        for (const author of AUTHORS)
          for (const authorKind of AUTHOR_KINDS)
            for (const kind of KINDS)
              for (const mentions of MENTIONS)
                for (const intent of INTENTS) {
                  const m = makeMsg({ to, author, authorKind, kind, mentions, intent });
                  const entry = makeEntry({ memberCount, isMember });
                  const got = classify(m, entry, ME);
                  const want = oracle(m, entry, ME);
                  assert.equal(
                    got,
                    want,
                    `to=${to} members=${memberCount} isMember=${isMember} author=${author} authorKind=${authorKind} kind=${kind} mentions=${mentions} intent=${intent} -> got ${got}, want ${want}`
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
      KINDS.length *
      MENTIONS.length *
      INTENTS.length
  );
});

// ── The mention read itself, before it is a verdict ──────────────────────────
// `mentionsMe` is the ONE predicate two readers share (classify's 'fyi' verdict and
// listener-messages' task-reply notice gate), so it is asserted on its own terms as well as
// through the table — a shared predicate tested only through one of its callers is how the
// other caller's behaviour becomes an accident.

test("mentionsMe: only an exact id inside a real array counts", () => {
  const with_ = (mentionedUserIds) => ({ metadata: { mentionedUserIds } });
  assert.equal(mentionsMe(with_([ME]), ME), true);
  assert.equal(mentionsMe(with_([U3, ME]), ME), true, "position in the set does not matter");
  assert.equal(mentionsMe(with_([` ${ME} `]), ME), true, "trimmed, like every other id read");
  assert.equal(mentionsMe(with_([U3]), ME), false, "somebody ELSE's tag is not mine");
  assert.equal(mentionsMe(with_([]), ME), false);
  assert.equal(mentionsMe(with_([ME.toUpperCase()]), ME), false, "ids compare exactly, never loosely");
});

test("mentionsMe: every shape a wire value can take degrades to SILENCE", () => {
  // ⚠ THE FAIL DIRECTION IS THE POINT. A missed banner is recoverable from the Tags inbox; a
  // throw inside dispatchMessage is a DEFERRAL that holds the channel's cursor (the poison
  // ladder), and a permissive read is a notification anybody could forge.
  for (const junk of [undefined, null, "", 0, ME, { 0: ME }, [null, 7, {}]]) {
    assert.equal(mentionsMe({ metadata: { mentionedUserIds: junk } }, ME), false, JSON.stringify(junk) || "empty");
  }
  assert.equal(mentionsMe({ metadata: {} }, ME), false, "absent = tags nobody (every pre-Phase-6 row)");
  assert.equal(mentionsMe({}, ME), false);
  assert.equal(mentionsMe(null, ME), false);
  assert.equal(mentionsMe({ metadata: { mentionedUserIds: [ME] } }, null), false, "no operator identity, no tag");
  assert.equal(mentionsMe({ metadata: { mentionedUserIds: [ME] } }, ""), false);
});

// ── Explicit, hand-reasoned expectations (independent of the oracle) ─────────

const foreign = { authorUserId: U2, authorKind: "user", kind: "message", id: "x", seq: 1, body: "hi" };
const to = (tid) => ({ ...foreign, metadata: { to_user_id: tid } });
const plain = { ...foreign, metadata: {} };

// The server's stamped mention set, added to any fixture. ⚠ EVERY 'fyi' BELOW GOES THROUGH
// THIS (2026-08-18, wiring plan Phase 7): the untagged half of each pair is the retirement of
// per-message notifications, the tagged half is the escalation that replaced it, and the pair
// is what stops either direction being asserted alone.
const tagged = (m, ids = [ME]) => ({ ...m, metadata: { ...(m.metadata || {}), mentionedUserIds: ids } });

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

test("addressed to a third party -> ignore untagged, fyi when it tags me, never as a non-member", () => {
  // Somebody else's request that names me in the body IS an escalation — tagging me inside a
  // message aimed at a third party is the "I'm blocked, look at this" case the policy is for.
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "ignore");
  assert.equal(classify(tagged(to(U3)), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  // Membership still wins over the tag: a public channel I am not in raises nothing at all.
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
  assert.equal(classify(tagged(to(U3)), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("addressed to me stays a TRIGGER whether or not it tags me — the escalation carve-out", () => {
  // ⚠ THE ONE VERDICT THE MENTION GATE DOES NOT TOUCH, and the reason is the flow behind it:
  // 'trigger' opens a consent row and the launch panel waits on the notification that comes
  // with it. Gating that on whether the sender typed a name would hide requests.
  const entry = makeEntry({ memberCount: 3, isMember: true });
  assert.equal(classify(to(ME), entry, ME), "trigger");
  assert.equal(classify(tagged(to(ME)), entry, ME), "trigger");
  assert.equal(classify(tagged(to(ME), [U3]), entry, ME), "trigger", "somebody else's tag changes nothing either");
});

test("self-addressed noise stays ignore EVEN WHEN it tags me (the tag does not reorder the brake)", () => {
  // A post whose declared addressee is its own author is malformed, not an escalation, and
  // this branch is a loop brake. Moving the tag above it would be a new rule, not this one.
  const entry = makeEntry({ memberCount: 2, isMember: true });
  assert.equal(classify(tagged(to(U2)), entry, ME), "ignore");
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
test("unaddressed + exactly 2 members + member -> never trigger; fyi only when it tags me", () => {
  // ⚠ RE-AIMED AGAIN 2026-08-18 (Phase 7): the load-bearing claim is still "an unaddressed
  // post triggers nobody", and the FYI half is now the mention gate rather than membership.
  assert.equal(classify(plain, makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
  assert.equal(classify(tagged(plain), makeEntry({ memberCount: 2, isMember: true }), ME), "fyi");
  assert.notEqual(classify(tagged(plain), makeEntry({ memberCount: 2, isMember: true }), ME), "trigger");
  // Fail-closed the other way too: a non-member sees nothing, tagged or not.
  assert.equal(classify(plain, makeEntry({ memberCount: 2, isMember: false }), ME), "ignore");
  assert.equal(classify(tagged(plain), makeEntry({ memberCount: 2, isMember: false }), ME), "ignore");
});

// ⚠ THE MEMBER COUNT IS NOT READ AT ALL any more, which is a stronger statement
// than "2 does not trigger" and is the one worth pinning: a future change that
// re-introduces a count-keyed branch has to make one of these rows disagree.
test("the verdict is INDEPENDENT of memberCount for an unaddressed post", () => {
  for (const memberCount of [2, 3, 0, undefined, 99]) {
    assert.equal(
      classify(plain, makeEntry({ memberCount, isMember: true }), ME),
      "ignore",
      `memberCount ${memberCount} changed an unaddressed verdict`
    );
    // Asserted on BOTH sides of the mention gate, or "independent of the count" would be
    // satisfied by a classify that had stopped answering anything at all.
    assert.equal(
      classify(tagged(plain), makeEntry({ memberCount, isMember: true }), ME),
      "fyi",
      `memberCount ${memberCount} changed a TAGGED unaddressed verdict`
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
// ⚠ AND IT IS SHARPER SINCE PHASE 7, NOT SOFTER. There is now a real per-message mute in the
// product again — the mention gate — so "quiet in this one channel" is exactly the feature a
// reader might think this field could be revived for. It cannot: two of its three options did
// not do what their labels said. A quiet-in-one-channel control is a NEW design.
test("(F-170) a leftover myNotifyScope on the entry changes nothing", () => {
  const base = makeEntry({ memberCount: 2, isMember: true });
  for (const stale of ["none", "addressed", "all"]) {
    assert.equal(
      classify(tagged(plain), { ...base, channel: { ...base.channel, myNotifyScope: stale } }, ME),
      "fyi",
      `a stored notify scope of '${stale}' must not silence a TAG`
    );
    assert.equal(
      classify(plain, { ...base, channel: { ...base.channel, myNotifyScope: stale } }, ME),
      "ignore",
      `a stored notify scope of '${stale}' must not un-silence an untagged post either`
    );
    assert.equal(
      classify(to(ME), { ...base, channel: { ...base.channel, myNotifyScope: stale } }, ME),
      "trigger",
      `a stored notify scope of '${stale}' must never silence an ADDRESSED request`
    );
  }
});

test("unaddressed + 3+ members -> silent untagged, fyi when tagged (the general case)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 3, isMember: true }), ME), "ignore");
  assert.equal(classify(tagged(plain), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
});

test("unaddressed + unknown/invalid memberCount -> the same pair (degrades to multi-member)", () => {
  for (const memberCount of [undefined, 0]) {
    assert.equal(classify(plain, makeEntry({ memberCount, isMember: true }), ME), "ignore");
    assert.equal(classify(tagged(plain), makeEntry({ memberCount, isMember: true }), ME), "fyi");
  }
});

test("isMember missing field degrades to member (a tag still lands, it is not read as non-member)", () => {
  // The degradation is what this pins, so it has to be asserted on the side that CHANGES:
  // untagged is 'ignore' for member and non-member alike and would prove nothing.
  assert.equal(classify(tagged(plain), makeEntry({ memberCount: 3, isMember: "undefined" }), ME), "fyi");
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

test("(b) agent addressed to a third party -> silent unless it tags me", () => {
  assert.equal(classify(agentTo(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "ignore");
  assert.equal(classify(tagged(agentTo(U3)), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(tagged(agentTo(U3)), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("agent self-addressed (to === author) -> ignore", () => {
  assert.equal(classify(agentTo(U2), makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("(c) agent UNADDRESSED + exactly 2 members -> never trigger (LOOP BRAKE), and now silent", () => {
  // ⚠ THIS CASE NO LONGER DISTINGUISHES AGENT FROM USER, and that is the point
  // of the retirement rather than a weakening of it: a USER here used to
  // trigger the implicit 1:1, so the loop brake had to be an agent-only special
  // case. Now NOTHING unaddressed triggers, and the brake is the general rule.
  // Kept because it is the case a regression would reach for first.
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
  // ⚠ AND THIS IS THE SHAPE PHASE 7 WAS BUILT FOR: a peer's agent narrating turn after turn
  // into a channel I am in used to raise one banner PER MESSAGE. Tagged, it still reaches me.
  assert.equal(classify(tagged(agentPlain), makeEntry({ memberCount: 2, isMember: true }), ME), "fyi");
  // Public non-member still ignores.
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 2, isMember: false }), ME), "ignore");
});

test("(d) agent UNADDRESSED + 3+ members -> the same pair", () => {
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 3, isMember: true }), ME), "ignore");
  assert.equal(classify(tagged(agentPlain), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(tagged(agentPlain), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
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
  // to the addressed-to-third-party rule -> the mention gate.
  const entry = makeEntry({ memberCount: 3, isMember: true });
  assert.equal(classify(taskReply({ to_user_id: U3 }), entry, ME), "ignore");
  assert.equal(classify(tagged(taskReply({ to_user_id: U3 })), entry, ME), "fyi");
});

// ⚠ THE 'task-reply' VERDICT IS DELIBERATELY NOT MENTION-GATED (2026-08-18, Phase 7). It is a
// ROUTING statement — "this is not a fresh request" — and folding the tag into it would drop
// the SUPPRESSION along with the banner, so the peer's reply would spawn a counter-session
// against itself. The notice it drives IS gated, one layer up, in listener-messages.js's
// dispatch, on the same `targeting.mentionsMe` predicate. Pinned here because the natural
// "finish the job" edit is to move that conjunct down into this function.
test("(task-h) the task-reply verdict is unmoved by the mention set, in either direction", () => {
  const entry = makeEntry({ memberCount: 2, isMember: true });
  assert.equal(classify(taskReply(), entry, ME), "task-reply");
  assert.equal(classify(tagged(taskReply()), entry, ME), "task-reply");
  assert.equal(classify(tagged(taskReply(), [U3]), entry, ME), "task-reply");
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
