// P1-5 — THE LOOP BRAKE WAS VOID IN EVERY DM, WHICH IS WHERE THE PRODUCT LIVES.
//
// THE DEFECT, in three files that each looked right on its own:
//   1. `trigger.js` answers a busy channel with a courtesy no-op ("I'm still
//      finishing a previous request — please resend in a moment") and an auth
//      hold with another. Both go out through `postResult` with NO metadata and
//      NO addressee.
//   2. `targeting.js`'s LOOP BRAKE comment says exactly that is safe: "the
//      responder posts its reply UNADDRESSED … so it lands here as FYI and cannot
//      re-trigger the asker."
//   3. `service-writes-metadata.resolvePostMetadata` addresses it anyway. In a
//      DIRECT channel `toUserId` falls back to `peerUserId` when the caller named
//      nobody, so the post arrives with `to_user_id` stamped — and `classify`'s
//      ADDRESSED rule claims it and returns 'trigger', several branches before
//      the loop brake is ever reached.
//
// So a message that asked for nothing raised a consent card on the peer and could
// spawn a session under a synthetic `task-<channel>-<seq>` id, against the
// courtesy note itself. Two agents can ping-pong that way. Only the consent gate
// stopped it — and standing trust, which the product offers, removes the gate.
//
// THE FIX is `intent:"chat"`, and this suite pins the three properties that make
// it the CORRECT fix rather than a plausible one:
//   - `classify` suppresses chat UNCONDITIONALLY and AHEAD of the addressed rule,
//     so it holds even though the server still stamps an addressee in some cases;
//   - the courtesy call sites actually send it (a named helper, so the property
//     belongs to the message rather than to somebody's memory);
//   - the REAL reply does NOT send it — a fix that muted the answer too would be
//     the same outage from the other direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const read = (f) => readFileSync(join(HERE, "..", "main", f), "utf8");
const { classify } = require("../main/targeting.js");

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";

/** A DIRECT channel: two members, and the server addresses every post in it. */
const dm = () => ({
  channel: { id: "c1", name: "DM", memberCount: 2, isMember: true, isDirect: true },
});

/**
 * The wire shape of a courtesy no-op AS THE SERVER STORES IT in a DM: agent
 * author, no addressee the CALLER named — and `to_user_id` stamped anyway by the
 * direct-channel auto-address. That stamp is the whole point: it is what made the
 * documented brake unreachable.
 */
const courtesy = (over = {}) => ({
  id: "m1",
  seq: 42,
  kind: "message",
  authorKind: "agent",
  authorUserId: PEER,
  body: "I'm still finishing a previous request in this channel — please resend in a moment.",
  metadata: { to_user_id: ME, ...(over.metadata || {}) },
  ...over,
});

// ── 1. the classifier ──────────────────────────────────────────────────────────

test("THE BUG: an auto-addressed courtesy no-op triggers the peer", () => {
  // Kept as a live assertion rather than prose, because it is the thing the fix
  // is measured against: without the marker this really does raise consent.
  assert.equal(classify(courtesy(), dm(), ME), "trigger");
});

test("…and with intent 'chat' it triggers nobody", () => {
  const m = courtesy({ metadata: { to_user_id: ME, intent: "chat" } });
  assert.equal(classify(m, dm(), ME), "fyi");
});

test("the suppression wins DESPITE the addressee, not because it is absent", () => {
  // The ordering is the load-bearing part. `intent` is checked before every
  // branch that can return 'trigger', so it holds even where the server stamps
  // an addressee anyway — which in a DM it always does. If the chat branch ever
  // moves below the addressed rule, this is what fails.
  for (const to of [ME, PEER, undefined]) {
    const metadata = { intent: "chat", ...(to ? { to_user_id: to } : {}) };
    assert.notEqual(classify(courtesy({ metadata }), dm(), ME), "trigger", `to=${to}`);
  }
});

test("a REAL addressed request in the same DM still triggers", () => {
  // The control. A fix that suppressed the working message too would be the same
  // outage from the other side, and "nothing triggered" would look like success.
  assert.equal(classify(courtesy({ authorKind: "user" }), dm(), ME), "trigger");
  assert.equal(classify(courtesy(), dm(), ME), "trigger");
});

// ── 2. the call sites ──────────────────────────────────────────────────────────

test("every courtesy no-op goes out through postCourtesy, and the real reply does not", () => {
  const post = read("channel-post.js");
  const trigger = read("trigger.js");
  const headless = read("trigger-headless.js");

  // The helper stamps the marker, in one place.
  assert.match(post, /async function postCourtesy\(entry, m, text\) \{\s*return postResult\(entry, m, text, null, \{ intent: 'chat' \}\);/);

  // All three no-ops use it: the busy defer in each lane, and the auth hold.
  assert.match(trigger, /postCourtesy\(entry, m, AUTH_HELD_REPLY\)/);
  assert.match(trigger, /postCourtesy\(entry, m, RESEND\)/);
  assert.match(headless, /postCourtesy\(entry, m, RESEND\)/);
  const sites = [trigger, headless].flatMap((s) => s.match(/postCourtesy\(/g) || []);
  assert.equal(sites.length, 3, "exactly the three courtesy no-ops");

  // …and the APPROVED REPLY is still a plain request. This is the assertion that
  // keeps the fix from becoming a mute: `outboundApproved` posts the answer the
  // operator reviewed, and that one must reach the peer's machine.
  assert.match(trigger, /postResult\(entry, m, reply, \{ taskId: taskIdFor\(rec\) \}\)/);
  const approved = trigger.slice(trigger.indexOf("async function outboundApproved"));
  assert.ok(!approved.slice(0, 400).includes("postCourtesy"), "the real reply is not chat");
});

test("postResult only stamps an intent when one is given", () => {
  // Every other caller — the approved reply, and anything added later — must send
  // byte-for-byte what it sent before. An absent intent stamps no key at all,
  // server-side and here.
  const post = read("channel-post.js");
  assert.match(post, /\.\.\.\(opts && opts\.intent \? \{ intent: opts\.intent \} : \{\}\)/);
});

// ── 3. the comments that asserted the false invariant ──────────────────────────

test("both false invariants are corrected where they were written", () => {
  // These two comments are why the bug survived review: each file was locally
  // coherent and the pair was wrong. A reader who trusts them instead of
  // re-deriving the DM path gets the same wrong answer, so the correction is part
  // of the fix rather than decoration.
  const targeting = read("targeting.js");
  assert.ok(
    !/so it lands here as FYI and cannot re-trigger the asker/.test(targeting),
    "targeting.js still claims an unaddressed reply reaches the loop brake"
  );
  assert.match(targeting, /THE SECOND CLAUSE OF THIS COMMENT WAS FALSE IN EVERY DM/);
  // ⚠ AND THE CORRECTION IS ITSELF NOW HISTORY. The `peerUserId` fallback the
  // corrected comment described was REMOVED 2026-08-18 (wiring plan Phase 3), so
  // targeting.js must state it in the PAST TENSE — a present-tense description of
  // a retired server behaviour is the same class of wrong comment this test was
  // written to catch, one retirement later.
  assert.match(targeting, /`resolvePostMetadata` fell back to/);
  assert.match(targeting, /HISTORY, NOT BEHAVIOUR/);
  assert.ok(
    !/`resolvePostMetadata` falls back to/.test(targeting),
    "targeting.js still describes the DM auto-address as live"
  );

  const post = read("channel-post.js");
  assert.ok(
    !/pass no metadata and render as\n\/\/ plain agent bubbles, outside any session/.test(post),
    "channel-post.js still claims an incidental post lands outside any session"
  );
  assert.match(post, /THIS COMMENT USED TO CARRY A FALSE INVARIANT/);
});
