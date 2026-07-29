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
