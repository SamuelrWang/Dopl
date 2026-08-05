// Truth-table tests for the Channels listener's `classify()` targeting verdict.
//
// Run: `node --test dopl-desktop-app/test/classify.test.mjs`
//   (or point --test at any glob that includes this file).
//
// WHY SOURCE EXTRACTION: targeting.js (like the rest of dopl-desktop-app/main)
// is a CommonJS module and `classify` is private (non-exported). Rather than
// touch production code to export it, this test reads the real source and
// evaluates the exact `classify` + `metaStr` definitions verbatim. If the source
// changes, the extracted functions change with it, so the test stays honest to
// prod. (This already paid off: it surfaced two rules — self-addressed-noise and
// the implicit-mute — that a stale copy of the function did not have.)
//
// SPLIT NOTE: `classify`/`metaStr` moved from channel-listener.js to targeting.js
// in the §2 refactor; the source path below was repointed in the same change.
//
// File is `.mjs` (ESM) so it stays clean under the repo's shared eslint config,
// which flags the CommonJS `require()` the rest of dopl-desktop-app/main uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");

// Extract a top-level `function <name>(...) { ... }` block by brace-balancing
// from its opening brace. `classify` and `metaStr` contain no braces inside
// strings/comments/regex, so a plain brace count is exact for them.
function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in targeting.js`);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return SRC.slice(start, i);
}

// The LEGACY-THREADS block carries module state (the registry Map + its cap), so it is
// sliced WHOLE between its sentinels rather than function by function. classify calls into
// it, so it has to be in the evaluated scope; slicing the real block keeps this harness as
// honest as the brace-balanced functions around it.
// §2 SPLIT (2026-07-31): the LEGACY-THREADS registry classify calls into moved to its own
// module when targeting.js went past the 500-line cap; classify's body did not change, so only
// the FILE this block is sliced out of did. It carries module state, hence the whole-block cut.
const LEGACY_SRC = readFileSync(join(HERE, "..", "main", "legacy-threads.js"), "utf8");
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);
assert.ok(LEGACY.includes("function knownLegacyReply"), "LEGACY-THREADS sentinels missing");

// Build the real classify() in an isolated scope alongside its metaStr helper. Every
// `new Function` call gets a FRESH registry, so no test can leak state into another.
const build = () =>
  new Function(
    `${extractFn("metaStr")}\n${LEGACY}\n${extractFn("classify")}\n` +
      `return { classify, metaStr, noteMyLegacyThread, knownLegacyReply, legacyThreadId };`
  )();
const { classify } = build();

const ME = "me-uuid";
const U2 = "author-uuid"; // a foreign author
const U3 = "third-uuid"; // a distinct third party

// Reference oracle re-derived from the CURRENT source's documented rules.
// UPDATED for the ask-another-agent fix: an agent EXPLICITLY addressed to me
// now triggers (it used to be dropped by a blanket "user author" guard), while
// an UNADDRESSED agent stays FYI/ignore — the loop brake.
//   guards (fail closed): message kind, author present, known id, never my own
//     message; authorKind must be 'user' or 'agent' (else -> ignore, e.g.
//     'system').
//   addressed (to_user_id present) — USER *and* AGENT authors alike:
//     - to === me            -> trigger (explicit address always prompts)
//     - to === the author    -> ignore  (self-addressed noise)
//     - else                 -> fyi (member) / ignore (public non-member)
//   unaddressed AGENT author:
//     - fyi (member) / ignore (public non-member) — NEVER an implicit trigger
//       (LOOP BRAKE: the responder's reply is unaddressed so it can't re-trigger)
//   unaddressed USER author (unchanged):
//     - exactly 2 members + member -> trigger, UNLESS myNotifyScope === 'none'
//       (an explicit mute wins over an IMPLICIT target) -> ignore
//     - otherwise            -> fyi (member) / ignore (public non-member)
function oracle(m, entry, myId) {
  if (!m || m.kind !== "message" || !m.authorUserId) return "ignore";
  if (m.authorKind !== "user" && m.authorKind !== "agent") return "ignore";
  if (!myId) return "ignore";
  if (m.authorUserId === myId) return "ignore";

  const ch = entry.channel;
  const isMember = !(ch && ch.isMember === false);
  const to =
    m.metadata && typeof m.metadata.to_user_id === "string" && m.metadata.to_user_id.trim()
      ? m.metadata.to_user_id.trim()
      : "";
  if (to) {
    if (to === myId) return "trigger";
    if (to === m.authorUserId) return "ignore";
    return isMember ? "fyi" : "ignore";
  }
  // Unaddressed agent -> never an implicit trigger (loop brake); FYI/ignore only.
  if (m.authorKind === "agent") return isMember ? "fyi" : "ignore";
  const cnt = Number(ch && ch.memberCount);
  const knownTwo = Number.isFinite(cnt) && cnt === 2;
  const scope = (ch && ch.myNotifyScope) || "all";
  if (knownTwo && isMember) return scope === "none" ? "ignore" : "trigger";
  return isMember ? "fyi" : "ignore";
}

// `to` targets: me / the author itself (self-addressed) / a third party / none.
function targetId(to, authorId) {
  if (to === "me") return ME;
  if (to === "author") return authorId;
  if (to === "third") return U3;
  return null;
}

function makeMsg({ to, author, authorKind, kind }) {
  const authorUserId = author === "me" ? ME : U2;
  const tid = targetId(to, authorUserId);
  return {
    id: "x",
    seq: 1,
    body: "hi",
    kind,
    authorKind,
    authorUserId,
    metadata: tid ? { to_user_id: tid } : {},
  };
}

function makeEntry({ memberCount, isMember, myNotifyScope }) {
  const channel = { id: "chan-abcdef01", name: "General", memberCount };
  if (isMember !== "undefined") channel.isMember = isMember;
  if (myNotifyScope !== "undefined") channel.myNotifyScope = myNotifyScope;
  return { channel };
}

const TO = ["me", "author", "third", "absent"];
const MEMBER_COUNTS = [2, 3, undefined, 0];
const IS_MEMBERS = [true, false, "undefined"];
const AUTHORS = ["me", "other"];
const AUTHOR_KINDS = ["user", "agent", "system"];
const KINDS = ["message", "task_started"];
const SCOPES = ["all", "addressed", "none", "undefined"];

test("classify truth table — full combination sweep matches the spec oracle", () => {
  let n = 0;
  for (const to of TO)
    for (const memberCount of MEMBER_COUNTS)
      for (const isMember of IS_MEMBERS)
        for (const author of AUTHORS)
          for (const authorKind of AUTHOR_KINDS)
            for (const kind of KINDS)
              for (const myNotifyScope of SCOPES) {
                const m = makeMsg({ to, author, authorKind, kind });
                const entry = makeEntry({ memberCount, isMember, myNotifyScope });
                const got = classify(m, entry, ME);
                const want = oracle(m, entry, ME);
                assert.equal(
                  got,
                  want,
                  `to=${to} members=${memberCount} isMember=${isMember} author=${author} authorKind=${authorKind} kind=${kind} scope=${myNotifyScope} -> got ${got}, want ${want}`
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
      SCOPES.length
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

test("addressed to me -> trigger, regardless of member count, membership, or mute", () => {
  assert.equal(classify(to(ME), makeEntry({ memberCount: 3, isMember: true }), ME), "trigger");
  assert.equal(classify(to(ME), makeEntry({ memberCount: 3, isMember: false }), ME), "trigger");
  // An explicit address is never suppressed by a per-channel mute.
  assert.equal(
    classify(to(ME), makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "none" }), ME),
    "trigger"
  );
});

test("self-addressed noise (to === author) -> ignore", () => {
  assert.equal(classify(to(U2), makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("addressed to a third party -> fyi as a member, ignore as a public non-member", () => {
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(to(U3), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("unaddressed + exactly 2 members + member -> trigger (implicit 1:1)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 2, isMember: true }), ME), "trigger");
});

test("unaddressed + 2 members + member + myNotifyScope 'none' -> ignore (implicit mute)", () => {
  assert.equal(
    classify(plain, makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "none" }), ME),
    "ignore"
  );
  // 'addressed' does NOT mute the implicit trigger (only 'none' does).
  assert.equal(
    classify(plain, makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "addressed" }), ME),
    "trigger"
  );
});

test("unaddressed + 3+ members -> fyi (classify never mutes fyi; sendFyi() does)", () => {
  assert.equal(classify(plain, makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(
    classify(plain, makeEntry({ memberCount: 3, isMember: true, myNotifyScope: "none" }), ME),
    "fyi"
  );
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
  // An explicit address is never suppressed by a per-channel mute.
  assert.equal(
    classify(agentTo(ME), makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "none" }), ME),
    "trigger"
  );
});

test("(b) agent addressed to a third party -> fyi (member) / ignore (non-member)", () => {
  assert.equal(classify(agentTo(U3), makeEntry({ memberCount: 3, isMember: true }), ME), "fyi");
  assert.equal(classify(agentTo(U3), makeEntry({ memberCount: 3, isMember: false }), ME), "ignore");
});

test("agent self-addressed (to === author) -> ignore", () => {
  assert.equal(classify(agentTo(U2), makeEntry({ memberCount: 2, isMember: true }), ME), "ignore");
});

test("(c) agent UNADDRESSED + exactly 2 members -> fyi, NOT trigger (LOOP BRAKE)", () => {
  // A USER here would trigger the implicit 1:1; an agent must not, or the
  // responder's own unaddressed reply would ping-pong back into a new trigger.
  assert.equal(classify(agentPlain, makeEntry({ memberCount: 2, isMember: true }), ME), "fyi");
  // Unconditional: scope 'all' does not lift the brake either.
  assert.equal(
    classify(agentPlain, makeEntry({ memberCount: 2, isMember: true, myNotifyScope: "all" }), ME),
    "fyi"
  );
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

// ── LEGACY thread replies (incident 2026-07-31) ──────────────────────────────
// A request that arrives WITHOUT create_thread gets a deterministic legacy id
// (`task-<channel>-<seq>`) minted by the responder's desktop. That id is not a UUID,
// so it resolves to no channel_tasks row and the server stamps NONE of the task keys
// the branch above needs (service-writes-metadata.ts deletes taskMode /
// taskCreatedBy / taskTitle / taskTarget unconditionally and re-adds them only from a
// resolved task). The reply therefore carried metadata.taskId and nothing else — and
// once it did not even carry that, it read as a brand-new request and the requester
// spawned a counter-session against the answer to its own question.
//
// Provenance comes from THIS MACHINE instead: classify records the legacy id of every
// thread the operator OPENS (their own addressed message, which no peer can author),
// and only a reply tagged with one of those ids, from the member it addressed, is
// passive news. Everything else falls through to the addressed rule -> 'trigger'.
const CHAN = "chan-abcdef01"; // the id makeEntry() builds
const legacyId = (seq) => `task-${CHAN}-${seq}`;
// MY OWN outbound request at `seq`, addressed to `to` (the shape that records).
const myAsk = (seq, to = U2, over = {}) => ({
  id: "o", seq, kind: "message", body: "please do X", authorKind: "agent",
  authorUserId: ME, metadata: { to_user_id: to, ...over },
});
// The peer's reply, tagged with the legacy id of MY message at `openerSeq`.
const legacyReply = (openerSeq, over = {}) => ({
  id: "r", seq: 20, kind: "message", body: "here is the answer", authorKind: "agent",
  authorUserId: U2, metadata: { to_user_id: ME, taskId: legacyId(openerSeq), ...over },
});
const chan = () => makeEntry({ memberCount: 2, isMember: true });
// A fresh scope per test: the registry is module state, so no test may inherit another's.
const fresh = () => build().classify;

test("(legacy-a) THE INCIDENT: my ask, then the peer's legacy-tagged reply -> task-reply", () => {
  const c = fresh();
  assert.equal(c(myAsk(7), chan(), ME), "ignore", "my own message is still 'ignore' for targeting");
  // No taskMode, no taskCreatedBy, no taskTarget: exactly what the server stores for a
  // legacy id. The first-class branch cannot fire here; the local record is what does.
  assert.equal(c(legacyReply(7), chan(), ME), "task-reply");
  // Explicitly addressed, so member count / membership / mute do not change it.
  assert.equal(c(legacyReply(7), makeEntry({ memberCount: 5, isMember: false }), ME), "task-reply");
});

test("(legacy-b) a legacy tag this machine does NOT know -> trigger (unchanged)", () => {
  // Never seen at all.
  assert.equal(fresh()(legacyReply(7), chan(), ME), "trigger");
  // Known thread, WRONG seq — one id per opening message, not per channel.
  const c = fresh();
  c(myAsk(7), chan(), ME);
  assert.equal(c(legacyReply(8), chan(), ME), "trigger");
  // Known seq, WRONG channel — the id embeds the channel, so a tag minted elsewhere misses.
  const d = fresh();
  d(myAsk(7), chan(), ME);
  assert.equal(d({ ...legacyReply(7), metadata: { to_user_id: ME, taskId: "task-other-7" } }, chan(), ME), "trigger");
});

test("(legacy-c) an UNTAGGED addressed message -> trigger (unchanged), even on a known thread", () => {
  const c = fresh();
  c(myAsk(7), chan(), ME);
  const untagged = { ...legacyReply(7), metadata: { to_user_id: ME } };
  assert.equal(c(untagged, chan(), ME), "trigger");
  // An empty / non-string tag is the same as no tag.
  assert.equal(c({ ...legacyReply(7), metadata: { to_user_id: ME, taskId: "  " } }, chan(), ME), "trigger");
  assert.equal(c({ ...legacyReply(7), metadata: { to_user_id: ME, taskId: 7 } }, chan(), ME), "trigger");
});

test("(legacy-d) only the member I ADDRESSED can answer my thread", () => {
  const c = fresh();
  c(myAsk(7, U2), chan(), ME); // I addressed U2
  const fromThird = { ...legacyReply(7), authorUserId: U3 };
  assert.equal(c(fromThird, makeEntry({ memberCount: 3, isMember: true }), ME), "trigger");
});

test("(legacy-e) a HUMAN author is never suppressed, even on a thread I opened (AUDIT D1)", () => {
  const c = fresh();
  c(myAsk(7), chan(), ME);
  assert.equal(c({ ...legacyReply(7), authorKind: "user" }, chan(), ME), "trigger");
  assert.equal(c({ ...legacyReply(7), authorKind: "system" }, chan(), ME), "ignore"); // guard wins
});

// What DOES and does not open a thread this machine will trust (the recorder's own
// rules), plus the cap and the operator binding, live in legacy-thread-reply.test.mjs.

test("(legacy-f) the kind guard still wins over a known legacy thread", () => {
  const c = fresh();
  c(myAsk(7), chan(), ME);
  assert.equal(c({ ...legacyReply(7), kind: "task_finished" }, chan(), ME), "ignore");
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

// The CHANNELS ROLLBACK's own regressions — the two D2 rules `classify` lost, pinned as
// absences — live in `classify-rollback.test.mjs`. Split off at the §2 500-line cap rather
// than trimmed: they are about a behaviour CHANGE where everything above is about the
// standing truth table, which is a real reason to change and not arithmetic.
