// The LEGACY thread registry — targeting.js, incident 2026-07-31.
//
// THE INCIDENT. User A's EXTERNAL Claude Code session posted an addressed plain message to
// user B. With no create_thread there is no channel_tasks row, so B's desktop minted the
// deterministic legacy id `task-<channelId>-<seq>` for it (trigger.js taskIdFor /
// handleTrigger's futureTaskId) and ran a responder session under that id. B's session
// posted its answer with `to = A` and NO thread linkage, and on A's machine that reply —
// addressed, agent-authored, untagged — was indistinguishable from a fresh request: consent
// popped and a counter-session spawned against the answer to A's own question. The v1.3.1
// loop brake did not cover it, because that brake relies on replies being UNADDRESSED and
// the v1.9+ session-window path addresses them explicitly.
//
// WHAT THE WIRE CAN AND CANNOT SAY (src/features/channels/server/service-writes-metadata.ts,
// resolvePostMetadata). `taskId` stays caller-settable, and a legacy id is passed straight
// through: only a UUID is resolved, and only an unresolved UUID is rejected. Because it
// never resolves, `task` stays null and the four reserved task keys — taskMode,
// taskCreatedBy, taskTitle, taskTarget — are deleted from caller metadata and NEVER
// re-stamped. So a legacy exchange carries taskId plus whatever the server itself owns
// (to_user_id, summary, runtime), and NOTHING that says who the thread belongs to. The
// first-class 'task-reply' branch, which needs taskCreatedBy + taskTarget + taskMode, can
// therefore never fire for one.
//
// THE ANSWER IS LOCAL. The legacy id is derived from (channel, seq) alone, so the operator's
// own machine can compute the exact id a peer will mint for MY message the moment it sees
// that message go by. classify records those ids as it passes its self-authored branch;
// a reply tagged with one of them, from the member it addressed, is my own outstanding
// request being answered. No peer can author a message as me, so no peer can plant a record.
//
// This file drives the REAL exported helpers (targeting.js is dependency-free). The registry
// is module state shared across these tests, so each one uses its own channel id.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const require = createRequire(import.meta.url);
const { legacyThreadId, noteMyLegacyThread, knownLegacyReply } = require("../main/targeting.js");

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const THIRD = "33333333-3333-3333-3333-333333333333";

const entryFor = (channelId) => ({ channel: { id: channelId, name: "General", memberCount: 2 } });
// MY OWN outbound request: seq `seq`, addressed to `to`.
const ask = (seq, to = PEER) => ({ kind: "message", seq, authorUserId: ME, metadata: { to_user_id: to } });
// A reply tagged with `taskId`, authored by `author`.
const reply = (taskId, author = PEER) => ({
  kind: "message", seq: 99, authorUserId: author, authorKind: "agent",
  metadata: { to_user_id: ME, taskId },
});

// ── the id itself ────────────────────────────────────────────────────────────────
// It must stay byte-identical to what the RESPONDER's desktop mints, because matching is a
// plain string lookup. trigger.js owns both of the other spellings.

test("legacyThreadId matches trigger.js taskIdFor / futureTaskId, byte for byte", () => {
  assert.equal(legacyThreadId("c1", 7), "task-c1-7");
  // The real shape: a UUID channel id (full of hyphens) plus the opening message's seq.
  const ch = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
  assert.equal(legacyThreadId(ch, 42), `task-${ch}-42`);
  assert.equal(legacyThreadId(ch, 42), `task-${ch}-${42}`); // the template trigger.js uses
});

// ── what opens a thread this machine will trust ──────────────────────────────────

test("my own ADDRESSED message opens the thread; the peer's reply to it is recognized", () => {
  const ch = "ch-open-1";
  noteMyLegacyThread(ask(7), entryFor(ch), ME);
  assert.equal(knownLegacyReply(reply(legacyThreadId(ch, 7)), ME), true);
});

test("an UNADDRESSED or SELF-addressed message of mine opens nothing", () => {
  const ch = "ch-open-2";
  noteMyLegacyThread({ kind: "message", seq: 7, authorUserId: ME, metadata: {} }, entryFor(ch), ME);
  noteMyLegacyThread(ask(8, ME), entryFor(ch), ME); // addressed back at myself
  noteMyLegacyThread({ kind: "message", seq: 9, authorUserId: ME }, entryFor(ch), ME); // no metadata bag
  for (const seq of [7, 8, 9]) {
    assert.equal(knownLegacyReply(reply(legacyThreadId(ch, seq)), ME), false, `seq ${seq}`);
  }
});

test("a malformed seq or a channel-less entry opens nothing (fails closed)", () => {
  const ch = "ch-open-3";
  noteMyLegacyThread(ask(0), entryFor(ch), ME);
  noteMyLegacyThread(ask(-1), entryFor(ch), ME);
  noteMyLegacyThread(ask(1.5), entryFor(ch), ME);
  noteMyLegacyThread(ask(undefined), entryFor(ch), ME);
  noteMyLegacyThread(ask(11), { channel: null }, ME);
  noteMyLegacyThread(ask(12), {}, ME);
  noteMyLegacyThread(ask(13), null, ME);
  for (const seq of [0, -1, 1.5, undefined, 11, 12, 13]) {
    assert.equal(knownLegacyReply(reply(legacyThreadId(ch, seq)), ME), false, `seq ${seq}`);
  }
  // A NUMERIC-STRING seq does record: it coerces to the same integer, and so to the same id
  // the responder's desktop mints from its own record. Consistency, not laxity.
  noteMyLegacyThread(ask("21"), entryFor(ch), ME);
  assert.equal(knownLegacyReply(reply(legacyThreadId(ch, 21)), ME), true);
});

// ── what a recorded thread will and will not accept back ─────────────────────────

test("only the member the thread ADDRESSES may answer it", () => {
  const ch = "ch-match-1";
  noteMyLegacyThread(ask(7, PEER), entryFor(ch), ME);
  const id = legacyThreadId(ch, 7);
  assert.equal(knownLegacyReply(reply(id, THIRD), ME), false, "a third member is not the responder");
  assert.equal(knownLegacyReply(reply(id, ME), ME), false, "and neither am I");
  assert.equal(knownLegacyReply(reply(id, PEER), ME), true);
});

test("an unknown, empty, or non-string tag is never a known reply", () => {
  const ch = "ch-match-2";
  noteMyLegacyThread(ask(7), entryFor(ch), ME);
  for (const tag of ["", "   ", "task-ch-match-2-8", "task-other-7", legacyThreadId(ch, 70), 7, null, undefined, { id: 1 }]) {
    assert.equal(knownLegacyReply(reply(tag), ME), false, `tag ${JSON.stringify(tag)}`);
  }
  assert.equal(knownLegacyReply({ metadata: {} }, ME), false);
  assert.equal(knownLegacyReply({}, ME), false);
});

test("the record is bound to the operator who made it (sign-out, sign-in as someone else)", () => {
  const ch = "ch-owner-1";
  noteMyLegacyThread(ask(7), entryFor(ch), ME);
  const id = legacyThreadId(ch, 7);
  assert.equal(knownLegacyReply(reply(id), THIRD), false, "another account never inherits my threads");
  assert.equal(knownLegacyReply(reply(id), ""), false);
  assert.equal(knownLegacyReply(reply(id), null), false);
  assert.equal(knownLegacyReply(reply(id), ME), true);
});

test("re-seeing the same message is idempotent, and a re-address wins", () => {
  const ch = "ch-idem-1";
  noteMyLegacyThread(ask(7, PEER), entryFor(ch), ME);
  noteMyLegacyThread(ask(7, PEER), entryFor(ch), ME);
  const id = legacyThreadId(ch, 7);
  assert.equal(knownLegacyReply(reply(id, PEER), ME), true);
  // The same (channel, seq) can only ever be one message, but the last write is the record.
  noteMyLegacyThread(ask(7, THIRD), entryFor(ch), ME);
  assert.equal(knownLegacyReply(reply(id, PEER), ME), false);
  assert.equal(knownLegacyReply(reply(id, THIRD), ME), true);
});

// ── the OTHER half: the reply has to carry the tag in the first place ────────────
// Recognizing a tagged reply is worth nothing if nothing tags one. A spawned session posts
// through the pre-approved dopl_channel tool, so its thread id has to reach the framing
// (prompt-framing.deliverySection reads ONLY the spawn context). These pin the surviving spawn
// site and every terminal echo that still carries a tag.
// ⚠ THERE USED TO BE TWO SPAWN SITES — see the first excision block below.
// ⚠ AND A SECOND POSTING PATH: the HEADLESS lane posted through channel-post and had to read the
// record's CONCRETE id rather than the first-class-only `rec.taskId`. `main/trigger-headless.js`
// is deleted (2026-08-20, Samuel's ruling), and with it the desktop posting on the agent's
// behalf at all — see the second excision block, at the case below.

test("trigger.js: the responder spawn context carries the thread id (legacy ids included)", () => {
  const src = M("trigger.js");
  const call = src.slice(src.indexOf("sessionEngine.launchResponderSession({"), src.indexOf("toolProfile: rec.toolProfile"));
  assert.match(call, /taskId: rec\.taskId \|\| taskId/, "the same id the engine runs the session under");
  // taskIdFor is what resolves that id, and it falls back to the legacy shape.
  assert.match(src, /return rec\.taskId \|\| `task-\$\{rec\.channelId\}-\$\{rec\.seq\}`;/);
});

// ⚠ THE SECOND SPAWN SITE IS GONE (2026-08-20, F-228). A test stood here —
// "session-dispatch.js: the requester spawn context carries the thread id too" — and pinned
// that `sessionEngine.launchRequesterSession({ … taskId … })` named the thread its context
// drove, for the same reason the responder pin above does: prompt-framing.deliverySection
// reads ONLY the spawn context, so a requester spawned without the thread id posted its reply
// to the peer as a brand-new request.
//
// It is excised rather than repointed because BOTH ends of it were deleted:
// `maybeOpenRequesterSession` (route 2 of five — the one that minted a REQUESTER WINDOW on the
// operator's OWN thread opener, which is the self-trigger bug the retirement was ruled from)
// and with it the only `launchRequesterSession` call site in session-dispatch.js. There is no
// requester spawn left on this machine to carry a thread id.
//
// ⚠ WHAT IT PROTECTED IS NOT ORPHANED. The invariant is "every outbound tag names the thread",
// and the RESPONDER half — the surviving spawn site, plus `taskIdFor(rec)` on every headless
// tag — is pinned by the two tests either side of this block. Those are the paths a legacy id
// can still travel.

test("every terminal echo tags through taskIdFor(rec), never the raw rec.taskId", () => {
  // ⚠ REWRITTEN DOWN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This case had
  // two halves and the FIRST is deleted: it sliced `trigger.js › outboundApproved` and pinned
  // THREE tags inside it — the reply itself (`postResult(entry, m, reply, { taskId: taskIdFor(rec) })`),
  // its `task_finished`, and the post-failed `task_failed` — plus that none of the three read
  // `rec.taskId` raw. That resolver posted the reply the `claude -p` lane had drafted, once a
  // human clicked Send on its review row: the DESKTOP posting on the agent's behalf, because a
  // headless run hands back a string and exits. Deleted with the lane.
  //
  // ⚠ THE INVARIANT IS UNCHANGED AND THE SECOND HALF STILL CARRIES IT. `rec.taskId` is unset for
  // a LEGACY inbound — it was `toOutbound` that used to backfill it, and that is deleted too —
  // so reading it directly is exactly how an echo ends up untagged, groups into nothing the
  // requester is watching, and reaches A's machine as a brand-new request. Every surviving
  // terminal echo lives in `trigger-outcomes.js` and goes through the injected `taskIdFor`.
  //
  // ⚠ AND THE REPLY ITSELF IS NOT ORPHANED BY THE EXCISION — it moved INTO the session. A
  // windowless agent posts its OWN bytes through the pre-approved `dopl_channel` tool when its
  // held call is released, and the thread id reaches it through the SPAWN CONTEXT, which is what
  // the case above this block pins. Nothing writes on the agent's behalf any more, so there is
  // no desktop-side reply tag left in trigger.js to assert.
  const src = M("trigger.js");
  const moved = M("trigger-outcomes.js");
  assert.equal(moved.match(/rec\.taskId/g), null, "trigger-outcomes.js must not read rec.taskId");
  assert.equal((moved.match(/taskIdFor\(rec\)/g) || []).length, 3, "cancelled + denied + interrupted");
  // ⚠ THE COUNT IS THE PIN. `outboundCancelled` is one of those three and NOW HAS NO CALLER —
  // its only dispatcher was the watcher's `await-outbound` expiry arm, deleted with the phase.
  // It is deliberately kept (approve-out itself is alive; only the watcher phase died), so the
  // count must stay 3 rather than quietly becoming 2 when somebody prunes it as dead.
  assert.match(moved, /async function outboundCancelled\(rec\)/);

  // trigger.js's own remaining reads of `rec.taskId` are ALL the same derivation: `taskIdFor`
  // itself, plus three inline `rec.taskId || taskId` spellings where `taskId` is already
  // `taskIdFor(rec)`. None can produce an untagged post. Pinned by exclusion so a BARE
  // `rec.taskId` cannot slip in beside them — CODE only, since the comments name the anti-pattern
  // in order to warn about it.
  const code = src.split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
    .join("\n");
  const raws = code.match(/rec\.taskId(?! \|\| (?:taskId|`task-))/g) || [];
  assert.deepEqual(raws, [], `trigger.js reads rec.taskId without the fallback: ${raws}`);
  assert.match(src, /return rec\.taskId \|\| `task-\$\{rec\.channelId\}-\$\{rec\.seq\}`;/,
    "…and taskIdFor is still the one place that resolves it");
});

// ── the bound, and the direction it fails in ─────────────────────────────────────

test("the registry is capped, and an evicted thread fails SAFE (back to the consent gate)", () => {
  const ch = "ch-cap-1";
  const CAP = 500; // LEGACY_THREAD_CAP
  noteMyLegacyThread(ask(1), entryFor(ch), ME); // the oldest entry
  for (let seq = 2; seq <= CAP + 1; seq++) noteMyLegacyThread(ask(seq), entryFor(ch), ME);
  // Oldest evicted -> the peer's reply prompts instead of notifying. That is the fail-safe
  // direction: a missed record costs a consent prompt, never a swallowed message.
  assert.equal(knownLegacyReply(reply(legacyThreadId(ch, 1)), ME), false);
  assert.equal(knownLegacyReply(reply(legacyThreadId(ch, CAP + 1)), ME), true, "the newest survives");
});

// ── FIX S5: THE REGISTRY WAS TOO BROAD, AND ENTRIES NEVER DIED ───────────────────
// Two facts made the original registry a real suppression primitive rather than a hint:
//   - it recorded EVERY addressed own message, and since v2.6 the server AUTO-ADDRESSES
//     every post in a DM, so in the ordinary 1:1 case that is every message the operator
//     sends — each one minting a legacy id a peer could later claim; and
//   - `metadata.taskId` is caller-settable for a legacy id with NO participation check
//     (F-083 leaves legacy ids un-gated for threading), so a peer could stamp a genuinely
//     NEW request with an old id of mine and get 'task-reply' — a passive banner with no
//     consent row, no gate and no Accept — for as long as the process lived.
// Openers-only + a TTL close both, and both miss toward 'trigger' (a consent prompt),
// never toward silence.

const { classify, LEGACY_THREAD_TTL_MS } = require("../main/targeting.js");
const HOUR = 60 * 60 * 1000;
// My own message that already carries a thread id — a CONTINUATION, not an opener.
const followUp = (seq, taskId, to = PEER) => ({
  kind: "message", seq, authorUserId: ME, metadata: { to_user_id: to, taskId },
});

test("ONLY AN OPENER opens a thread: a message already carrying a taskId records nothing", () => {
  const ch = "ch-opener-1";
  noteMyLegacyThread(followUp(7, legacyThreadId(ch, 3)), entryFor(ch), ME);
  noteMyLegacyThread(followUp(8, "cccccccc-3333-4ddd-8eee-ffffffffffff"), entryFor(ch), ME);
  for (const seq of [7, 8]) {
    assert.equal(knownLegacyReply(reply(legacyThreadId(ch, seq)), ME), false, `seq ${seq}`);
  }
});

test("…and multi-turn STILL matches, because the id is the OPENER's seq", () => {
  // The whole point: my later turns carry `thread=<the opener's id>`, so they are skipped
  // here while the one record they all reference keeps recognizing the peer's replies.
  const ch = "ch-opener-2";
  noteMyLegacyThread(ask(7), entryFor(ch), ME);
  const id = legacyThreadId(ch, 7);
  noteMyLegacyThread(followUp(9, id), entryFor(ch), ME); // turn 2 of the same thread
  noteMyLegacyThread(followUp(11, id), entryFor(ch), ME); // turn 3
  assert.equal(knownLegacyReply(reply(id), ME), true, "the opener's record still answers");
});

test("an entry EXPIRES: a banked legacy id cannot suppress consent forever", () => {
  const ch = "ch-ttl-1";
  const t0 = 1_800_000_000_000;
  noteMyLegacyThread(ask(7), entryFor(ch), ME, t0);
  const id = legacyThreadId(ch, 7);
  assert.equal(knownLegacyReply(reply(id), ME, t0 + LEGACY_THREAD_TTL_MS), true, "exactly at the TTL");
  assert.equal(knownLegacyReply(reply(id), ME, t0 + LEGACY_THREAD_TTL_MS + 1), false, "one ms past");
  // Dropped on read, so it cannot come back inside the window either.
  assert.equal(knownLegacyReply(reply(id), ME, t0 + 1), false, "the expired entry is gone, not just hidden");
});

test("the TTL is long enough for a real exchange and short enough to matter", () => {
  assert.ok(LEGACY_THREAD_TTL_MS >= 60 * 60 * 1000, "an hour would expire live work");
  assert.ok(LEGACY_THREAD_TTL_MS <= 24 * HOUR, "a day-plus is a bankable window");
});

// ── classify, both directions ────────────────────────────────────────────────────
// The registry only matters through classify's verdict, so drive it end to end.

const peerReply = (taskId) => ({
  kind: "message", seq: 99, authorUserId: PEER, authorKind: "agent",
  metadata: { to_user_id: ME, taskId },
});

test("classify: a reply on a recorded OPENER is passive news ('task-reply', no consent)", () => {
  const ch = "ch-classify-1";
  noteMyLegacyThread(ask(7), entryFor(ch), ME);
  assert.equal(classify(peerReply(legacyThreadId(ch, 7)), entryFor(ch), ME), "task-reply");
});

test("classify: a NEW request stamped with an id we never recorded still TRIGGERS", () => {
  const ch = "ch-classify-2";
  // The attack shape: the peer stamps a legacy id of a thread it did not open with me.
  assert.equal(classify(peerReply(legacyThreadId(ch, 7)), entryFor(ch), ME), "trigger");
  // And one recorded only as a CONTINUATION is likewise unknown.
  noteMyLegacyThread(followUp(7, legacyThreadId(ch, 3)), entryFor(ch), ME);
  assert.equal(classify(peerReply(legacyThreadId(ch, 7)), entryFor(ch), ME), "trigger");
});

test("classify: an EXPIRED record falls back to the consent gate, not to silence", () => {
  const ch = "ch-classify-3";
  noteMyLegacyThread(ask(7), entryFor(ch), ME, Date.now() - LEGACY_THREAD_TTL_MS - 1000);
  assert.equal(classify(peerReply(legacyThreadId(ch, 7)), entryFor(ch), ME), "trigger",
    "a miss costs a prompt — never a swallowed message");
});
