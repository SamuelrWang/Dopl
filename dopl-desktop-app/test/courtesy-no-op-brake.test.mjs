// P1-5 — THE LOOP BRAKE WAS VOID IN EVERY DM, WHICH IS WHERE THE PRODUCT LIVES.
//
// THE DEFECT, in three files that each looked right on its own:
//   1. `trigger.js` answers a busy channel with a courtesy no-op ("I'm still
//      finishing a previous request — please resend in a moment") and an auth
//      hold with another. Both go out through `postResult` with NO metadata and
//      NO addressee. (⚠ A THIRD JOINED THEM 2026-08-20 — `CANNOT_RUN`, the terminal for a
//      launch the engine refuses outright, which used to fall through to the `claude -p` lane
//      instead of answering. Same shape, same brake, and the census below is what forced it to
//      be given one.)
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
import { readFileSync, readdirSync } from "node:fs";
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
  // ⚠ 'ignore', not 'fyi', since 2026-08-18 (wiring plan Phase 7): the courtesy no-op tags
  // nobody, so it raises no desktop notification either. That is the RIGHT answer for this
  // message specifically — "I'm busy, please resend" is machine bookkeeping, and a banner per
  // busy agent is exactly the per-message noise the mention gate retired. The suppression this
  // file exists for is the trigger, and it is asserted on both sides below.
  const m = courtesy({ metadata: { to_user_id: ME, intent: "chat" } });
  assert.equal(classify(m, dm(), ME), "ignore");
  // Tagged, the same courtesy WOULD reach the operator — proof this is the mention gate
  // answering and not the chat brake having quietly become a mute.
  const taggedCourtesy = courtesy({ metadata: { to_user_id: ME, intent: "chat", mentionedUserIds: [ME] } });
  assert.equal(classify(taggedCourtesy, dm(), ME), "fyi");
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

test("every courtesy no-op goes out through postCourtesy, and nothing else does", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). Two of this case's
  // anchors were deleted on the same day, in opposite directions, and both are worth stating:
  //
  //   · `main/trigger-headless.js` is gone with the `claude -p` lane, so the THIRD courtesy site
  //     — that lane's own busy defer — is gone. The rule was never "there are three": it was
  //     "every no-op is marked, in every lane there is". There is one lane now.
  //   · `trigger.js › outboundApproved` is gone with it, and it was the CONTROL half of this
  //     case — the approved reply that must NOT be marked, because a fix that muted the answer
  //     too would be the same outage from the other direction. It posted the reply the operator
  //     had reviewed, on the agent's behalf, because a headless run hands back a string.
  //
  // ⚠ THE CONTROL IS REPLACED, NOT DROPPED, BECAUSE WITHOUT ONE THIS CASE DEGENERATES INTO
  // "everything is chat", which passes trivially and is the exact failure it was written
  // against. What stands in its place is stronger than the original: an ENUMERATION of every
  // `postCourtesy` call in main/, discovered off the tree rather than counted, plus the absence
  // of the marker from the posting helper the AGENT's own reply goes through. Approve-out did
  // not die — it moved INTO the session, where the agent posts its own bytes once its held tool
  // call is released, so the real reply never passes through this file's helpers at all.

  const post = read("channel-post.js");
  const trigger = read("trigger.js");

  // The helper stamps the marker, in one place.
  assert.match(post, /async function postCourtesy\(entry, m, text\) \{\s*return postResult\(entry, m, text, null, \{ intent: 'chat' \}\);/);

  // ALL THREE no-ops use it. The lane changed; the count did not, because the terminal that
  // replaced the headless fall-through needs a courtesy of its own.
  assert.match(trigger, /postCourtesy\(entry, m, AUTH_HELD_REPLY\)/, "the auth hold");
  assert.match(trigger, /postCourtesy\(entry, m, RESEND\)/, "the busy defer");
  // ⚠ THE NEW ONE (2026-08-20): the terminal that used to BE the headless lane. `cap` /
  // `no-sdk` / `disabled` no longer fall through to a second executor, so they answer the peer
  // here — and `CANNOT_RUN` is a no-op reply exactly like the other two, which means it needs
  // the same brake. A terminal added without it would raise a consent card on the peer in every
  // DM, which is P1-5 reopened by the very change that made the terminal necessary.
  assert.match(trigger, /postCourtesy\(entry, m, CANNOT_RUN\)/, "the cannot-run terminal");

  // THE ENUMERATION, off the tree: every courtesy in main/ is in trigger.js, and there are
  // exactly three of them. A fourth appearing anywhere is a no-op nobody has checked the
  // classifier against.
  const files = readdirSync(join(HERE, "..", "main")).filter((f) => f.endsWith(".js"));
  const senders = files.filter((f) => /postCourtesy\(/.test(stripComments(read(f)))).sort();
  assert.deepEqual(senders, ["channel-post.js", "trigger.js"],
    "the helper's own file, and the one lane that sends no-ops");
  assert.equal((stripComments(trigger).match(/postCourtesy\(/g) || []).length, 3,
    "exactly the three courtesy no-ops: busy, auth-hold, cannot-run");

  // …AND THE CONTROL. `postResult` is the unmarked poster — the one a REAL answer would use —
  // and the marker must never be stamped there by default, or the fix becomes a mute. This is
  // asserted at the helper rather than at a call site because trigger.js no longer HAS a
  // real-reply call site: the agent posts its own bytes from inside the session now.
  assert.match(post, /\.\.\.\(opts && opts\.intent \? \{ intent: opts\.intent \} : \{\}\)/,
    "an absent intent stamps no key at all");
  const bridge = read("session-windowless.js");
  assert.ok(!/intent: 'chat'/.test(stripComments(bridge)),
    "the windowless outbound bridge — where the real reply leaves now — must never mark it chat");
});

/** Comments legitimately NAME the deleted call sites (they explain why they are gone), so the
 *  census assertions above scan CODE only. */
const stripComments = (src) => src.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
  .join("\n");

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
