// Tests for the v1.7.4 FIX #2 lifecycle clientMsgId derivation (main/session-window.js
// echoSeq/echoTargets). SOURCE EXTRACTION: session-window.js requires electron at the top,
// but the SESSION-WINDOW-PURE block (echoSeq/echoTargets) references only its `info`
// argument, so we slice it and evaluate it verbatim in a plain Node context.
//
// The server dedupes lifecycle posts on clientMsgId = `${kind}-${channelId}-${seq}`
// (channel-post.postTaskEvent). This pins the seq contract: a NEW resume cycle posts a NEW
// row, a retry WITHIN one cycle collapses to one, and a taskless session keys off the STABLE
// sessionKey (never the per-launch ephemeral sessionId) so a P2 recreate can't double-post.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-window.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-WINDOW-PURE";
const END = "// ─── END SESSION-WINDOW-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-WINDOW-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-WINDOW-PURE sentinel missing");
assert.ok(to > from, "session-window sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-WINDOW-PURE block must not reference ${banned}`);
}

const { echoSeq, echoTargets } = new Function(`${BLOCK}\n return { echoSeq, echoTargets };`)();

// clientMsgId exactly as channel-post.postTaskEvent builds it.
const cid = (kind, info) => `${kind}-${info.channelId}-${echoTargets(info).m.seq}`;

// A tasked session cycle. `cycle` is the sdk id (or null for a pre-init crash).
const tasked = (cycle, sessionId = "sess-A") => ({
  channelId: "c1", taskId: "t1", key: "c1:t1", sessionId, sdkSessionId: cycle,
});

// ── the base + cycle shape ─────────────────────────────────────────────────────────

test("seq = base#cycle: taskId is the base, sdkSessionId is the cycle discriminator", () => {
  assert.equal(echoTargets(tasked("sdk-A")).m.seq, "t1#sdk-A");
});

test("a taskless session keys off the STABLE sessionKey, never the ephemeral sessionId", () => {
  const s = { channelId: "c1", taskId: "", key: "c1:", sessionId: "sess-A", sdkSessionId: "sdk-A" };
  const seq = echoTargets(s).m.seq;
  assert.equal(seq, "c1:#sdk-A", "base is the sessionKey");
  assert.ok(!seq.includes("sess-A"), "the per-launch sessionId is NOT the base");
});

// ── (1) a retry WITHIN one cycle dedupes ────────────────────────────────────────────

test("(1) same-cycle retry -> IDENTICAL clientMsgId (server dedupes to one row)", () => {
  const info = tasked("sdk-A");
  assert.equal(cid("task_failed", info), cid("task_failed", info));
  // The DELIBERATE crash-vs-reload dedupe is preserved: a runtime crash echo (live sdk id)
  // and the reload interrupted echo (persisted SAME sdk id) collapse to one row.
  const crash = tasked("sdk-A", "sess-A");
  const reload = tasked("sdk-A", "sess-A");
  assert.equal(cid("task_failed", crash), cid("task_failed", reload));
});

test("(1b) a P2 recreate (fresh sessionId, SAME key+cycle) does not double-post", () => {
  const original = { channelId: "c1", taskId: "", key: "c1:", sessionId: "sess-A", sdkSessionId: "sdk-A" };
  const recreate = { channelId: "c1", taskId: "", key: "c1:", sessionId: "sess-B", sdkSessionId: "sdk-A" };
  assert.equal(cid("task_started", original), cid("task_started", recreate), "sessionId drift is irrelevant to dedupe");
});

// ── (2) cap-end -> resume -> a NEW cycle posts a NEW row ─────────────────────────────

test("(2) cap-end (cycle A) then resume -> the new cycle's task_started gets a DIFFERENT id", () => {
  const startedA = cid("task_started", tasked("sdk-A"));
  const startedB = cid("task_started", tasked("sdk-B")); // resumed query minted sdk-B at its init
  assert.notEqual(startedA, startedB, "a new resume cycle is a NEW server row (P4 calmEndStatus clears)");
});

// ── (3) capped-then-crash -> two DISTINCT task_failed ids ───────────────────────────

test("(3) capped (cycle A) then a resumed-cycle crash -> two DISTINCT task_failed ids", () => {
  const capped = cid("task_failed", tasked("sdk-A")); // post-init cap, cycle A
  // Resumed cycle B crashes post-init (sdk-B): distinct.
  assert.notEqual(capped, cid("task_failed", tasked("sdk-B")));
  // Resumed IN PLACE then crashes PRE-init: resumeParked cleared sdkSessionId, so the id
  // falls back to the (per-object) sessionId — still distinct from cycle A's sdk id.
  const crashPreInit = tasked(null, "sess-A");
  assert.notEqual(capped, cid("task_failed", crashPreInit), "a post-cap crash is never swallowed");
  assert.equal(echoTargets(crashPreInit).m.seq, "t1#sess-A", "pre-init falls back to sessionId");
});

test("(3b) two distinct P2-recreate cycles that both die pre-init get distinct ids", () => {
  // Each recreate is a fresh session object (fresh sessionId); pre-init both have sdkSessionId
  // null, so the sessionId fallback keeps them distinct.
  const cycleB = tasked(null, "sess-B");
  const cycleC = tasked(null, "sess-C");
  assert.notEqual(cid("task_failed", cycleB), cid("task_failed", cycleC));
});

// ── P2-9 (2026-08-04): ONE TERMINAL ROW PER THREAD, ACROSS CYCLES AND MACHINES ────
//
// THE DEFECT. FIX #2 above folds the SDK resume cycle into every echo id, which
// answers "is this a distinct RUN" — a fact about THIS MACHINE. The thread card
// renders a different question: "how did this exchange END". So a session that
// parked and resumed five times posted FIVE terminal rows for ONE logical failure,
// and nothing deduped across machines either, because an sdk session id is local.
//
// THE FIX is scoped twice over, and both scopes are load-bearing:
//   - TERMINAL kinds only. `task_started` KEEPS its cycle: a resume really is a new
//     start, and `groupThread`'s restart detection reads those seqs — collapsing
//     them would make a resumed session look like it never restarted.
//   - FIRST-CLASS (UUID) thread ids only. A legacy `task-<channel>-<seq>` id is
//     minted per MESSAGE, so keying on it dedupes nothing the cycle key did not
//     already dedupe, and that path stays byte for byte.

const THREAD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const firstClass = (cycle, sessionId = "sess-A") => ({
  channelId: "c1", taskId: THREAD, key: `c1:${THREAD}`, sessionId, sdkSessionId: cycle,
});

test("P2-9: a terminal echo collapses across resume cycles for a first-class thread", () => {
  // The incident shape: same thread, five cycles, one failure.
  const cycles = ["sdk-1", "sdk-2", "sdk-3", null, "sdk-5"];
  for (const kind of ["task_finished", "task_failed"]) {
    const ids = new Set(cycles.map((c) => echoTargets(firstClass(c), kind).m.seq));
    assert.equal(ids.size, 1, `${kind}: five cycles must collapse to one row`);
    assert.equal([...ids][0], THREAD, `${kind}: keyed on the thread itself`);
  }
});

test("P2-9: it collapses across MACHINES too — no local id is in the key", () => {
  // The half a local `announced` set could never buy: two desktops answering the
  // same thread share no sdk id and no sessionId, and must still post one row.
  const a = echoTargets({ channelId: "c1", taskId: THREAD, sessionId: "mac-A", sdkSessionId: "sdk-A" }, "task_failed");
  const b = echoTargets({ channelId: "c1", taskId: THREAD, sessionId: "mac-B", sdkSessionId: "sdk-B" }, "task_failed");
  assert.equal(a.m.seq, b.m.seq);
});

test("P2-9: task_started KEEPS the cycle — a resume IS a new start", () => {
  const one = echoTargets(firstClass("sdk-1"), "task_started").m.seq;
  const two = echoTargets(firstClass("sdk-2"), "task_started").m.seq;
  assert.notEqual(one, two, "collapsing starts would hide every restart");
  assert.equal(one, `${THREAD}#sdk-1`);
});

test("P2-9: task_finished and task_failed do NOT collide with each other", () => {
  // They share a seq, and that is correct: the clientMsgId the server dedupes on
  // is `${kind}-${channelId}-${seq}`, so the KIND is already in the key.
  const info = firstClass("sdk-1");
  assert.equal(echoTargets(info, "task_finished").m.seq, echoTargets(info, "task_failed").m.seq);
  assert.notEqual(cid("task_finished", info), cid("task_failed", info));
});

test("P2-9: a LEGACY thread id keeps the cycle discriminator, byte for byte", () => {
  // `task-<channel>-<seq>` is minted per message, so there is nothing to gain and
  // an existing behaviour to lose.
  const legacy = { channelId: "c1", taskId: "task-c1-42", key: "c1:task-c1-42", sessionId: "s", sdkSessionId: "sdk-1" };
  assert.equal(echoTargets(legacy, "task_failed").m.seq, "task-c1-42#sdk-1");
  const other = { ...legacy, sdkSessionId: "sdk-2" };
  assert.notEqual(echoTargets(legacy, "task_failed").m.seq, echoTargets(other, "task_failed").m.seq);
});

test("P2-9: a session with NO thread id keeps the cycle too", () => {
  const taskless = { channelId: "c1", key: "c1:none", sessionId: "s", sdkSessionId: "sdk-1" };
  assert.equal(echoTargets(taskless, "task_failed").m.seq, "c1:none#sdk-1");
});

test("P2-9: an explicit `seq` still wins over everything (the live-trigger path)", () => {
  assert.equal(echoTargets({ ...firstClass("sdk-1"), seq: 7 }, "task_failed").m.seq, 7);
});
