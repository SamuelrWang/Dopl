// Tests for the v1.7.4 FIX #2 lifecycle clientMsgId derivation (main/trigger-outcomes.js
// echoSeq/echoTargets). SOURCE EXTRACTION: trigger-outcomes.js requires electron at the top,
// but the LIFECYCLE-ECHO-PURE block (echoSeq/echoTargets) references only its `info`
// argument, so we slice it and evaluate it verbatim in a plain Node context.
//
// ⚠ RENAMED AND REPOINTED 2026-08-20 (was `session-window-echoid.test.mjs`). The code it
// pins MOVED — the echo was never about windows, and `main/session-window.js` is being
// deleted with the window model (F-228). Moving the test WITH its subject, ahead of the
// deletion, is what keeps this rule from being swept up as window coverage.
//
// The server dedupes lifecycle posts on clientMsgId = `${kind}-${channelId}-${seq}`
// (channel-post.postTaskEvent). This pins the seq contract: a NEW resume cycle posts a NEW
// row, a retry WITHIN one cycle collapses to one, and a taskless session keys off the STABLE
// sessionKey (never the per-launch ephemeral sessionId) so a P2 recreate can't double-post.
//
// ⚠ REWRITTEN, NOT SHRUNK BY DELETION (wiring plan Phase 5, 2026-08-18 — INVARIANTS §14, a
// mixed test file whose feature is deleted is rewritten). ONE KIND reaches this derivation
// now: the calm `task_progress` session-ended note. `task_started` / `task_finished` /
// `task_failed` are no longer posted by this desktop at all, so the P2-9 cases — the terminal
// collapse across cycles and machines, the legacy-id carve-out, the started-keeps-its-cycle
// rule — were coverage of behaviour that no longer exists and went with `echoSeq`'s `kind`
// argument. Everything below is FIX #2, which the surviving note still depends on: a new run
// that ends is a new note, and a retry within one run is not.
//
// The second half of this file asserts the REMOVAL BEHAVIOURALLY rather than by grepping the
// source (INVARIANTS §14): the module is EXECUTED against a fake `electron` / `channel-post`,
// and what is checked is which posts really cross that seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "trigger-outcomes.js"), "utf8");

const BEGIN = "// ─── BEGIN LIFECYCLE-ECHO-PURE";
const END = "// ─── END LIFECYCLE-ECHO-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN LIFECYCLE-ECHO-PURE sentinel missing");
assert.notEqual(to, -1, "END LIFECYCLE-ECHO-PURE sentinel missing");
assert.ok(to > from, "lifecycle-echo sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `LIFECYCLE-ECHO-PURE block must not reference ${banned}`);
}

const { echoSeq, echoTargets } = new Function(`${BLOCK}\n return { echoSeq, echoTargets };`)();

// clientMsgId exactly as channel-post.postTaskEvent builds it. The kind is `task_progress`
// for every case here, because that is the only kind this module posts any more.
const cid = (info) => `task_progress-${info.channelId}-${echoTargets(info).m.seq}`;

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

test("a FIRST-CLASS (UUID) thread id is treated exactly like any other base", () => {
  // ⚠ THE P2-9 CARVE-OUT IS GONE. A UUID thread id used to collapse the TERMINAL echoes
  // across cycles; there are no terminal echoes, so the id shape decides nothing and the
  // note keeps its per-cycle discriminator like everything else.
  const THREAD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const info = { channelId: "c1", taskId: THREAD, key: `c1:${THREAD}`, sessionId: "s", sdkSessionId: "sdk-1" };
  assert.equal(echoTargets(info).m.seq, `${THREAD}#sdk-1`);
});

// ── (1) a retry WITHIN one cycle dedupes ────────────────────────────────────────────

test("(1) same-cycle retry -> IDENTICAL clientMsgId (server dedupes to one row)", () => {
  const info = tasked("sdk-A");
  assert.equal(cid(info), cid(info));
  // The DELIBERATE same-cycle dedupe survives: two paths reaching the note inside one run
  // (a crash teardown and the reload that follows it) share that cycle's sdk id.
  const crash = tasked("sdk-A", "sess-A");
  const reload = tasked("sdk-A", "sess-A");
  assert.equal(cid(crash), cid(reload));
});

test("(1b) a P2 recreate (fresh sessionId, SAME key+cycle) does not double-post", () => {
  const original = { channelId: "c1", taskId: "", key: "c1:", sessionId: "sess-A", sdkSessionId: "sdk-A" };
  const recreate = { channelId: "c1", taskId: "", key: "c1:", sessionId: "sess-B", sdkSessionId: "sdk-A" };
  assert.equal(cid(original), cid(recreate), "sessionId drift is irrelevant to dedupe");
});

// ── (2) a NEW run that ends is a NEW note ────────────────────────────────────────────

test("(2) end (cycle A) then resume and end again -> a DIFFERENT id", () => {
  assert.notEqual(cid(tasked("sdk-A")), cid(tasked("sdk-B")));
});

test("(3) a pre-init crash falls back to the per-object sessionId, keeping cycles distinct", () => {
  const crashPreInit = tasked(null, "sess-A");
  assert.equal(echoTargets(crashPreInit).m.seq, "t1#sess-A");
  // Two distinct P2-recreate cycles that both die pre-init stay distinct.
  assert.notEqual(cid(tasked(null, "sess-B")), cid(tasked(null, "sess-C")));
});

test("an explicit `seq` still wins over everything (the live-trigger path)", () => {
  assert.equal(echoTargets({ ...tasked("sdk-1"), seq: 7 }).m.seq, 7);
});

// ── THE THREE RUNTIME KINDS ARE NOT POSTED (wiring plan Phase 5, 2026-08-18) ─────────
//
// Executed, not grepped. `trigger-outcomes.js` requires `electron` (Notification, for the
// replied notice) plus five leaf modules; every one is faked here, and `postTaskEvent` is
// the seam the assertion watches. What it pins is the ASYMMETRY the phase depends on:
// this desktop stops CLAIMING a runtime in a shared transcript, while the calm milestone —
// the one thing a waiting peer needs — still goes out.
//
// ⚠ THE SERVER'S ACCEPTANCE OF THE THREE KINDS IS NOT TIGHTENED AND MUST NOT BE. Every
// installed build still posts them (INVARIANTS §13, desktop floor); the reader dropped them
// (`channels/components/view-model.ts › isLifecycleEcho`), which is the half that can ship alone.

// ⚠ THE STUB LIST IS AN ASSERTION, NOT PLUMBING. An unlisted require THROWS by name, so a
// future edit that reaches for a new dependency from this file fails here and is reviewed —
// the same idiom `session-window.js` used, carried over with the code.
function loadLifecycleEcho() {
  const posts = [];
  const stub = (id) => {
    if (id === "electron") return { Notification: function () {} };
    if (id === "./channel-post") {
      return { postTaskEvent: (...args) => { posts.push(args); return Promise.resolve(); } };
    }
    if (id === "./diag") return { diag: () => {} };
    if (id === "./targeting") return { truncate: (s) => s };
    if (id === "./consent-watcher") return { settle: () => {} };
    if (id === "./session-engine") return { closeConsentWindow: () => {} };
    if (id === "./channel-prefs") return { clearPermissionPreset: () => {} };
    throw new Error(`trigger-outcomes.js must not require ${JSON.stringify(id)}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  return { api: mod.exports, posts };
}

const INFO = { channelId: "c1", taskId: "t1", key: "c1:t1", sessionId: "s", workspaceId: "w" };

test("onLaunched posts NOTHING — a launch is a runtime fact, and the Agents tab reports it", () => {
  const { api, posts } = loadLifecycleEcho();
  api.lifecycleHandlers.onLaunched(INFO);
  assert.deepEqual(posts, [], "task_started is no longer a transcript row");
});

test("onEnded refuses task_finished and task_failed — a session ending is not a thread outcome", () => {
  const { api, posts } = loadLifecycleEcho();
  api.lifecycleHandlers.onEnded(INFO, "task_finished", {});
  api.lifecycleHandlers.onEnded(INFO, "task_failed", { capped: true }, "Limit reached");
  api.lifecycleHandlers.onEnded(INFO, "task_failed", { interrupted: true });
  // ⚠ And it does NOT coerce them into something else. The old code turned an unknown kind
  // into `task_finished`; dropping the post is the whole point, so a coercion here would
  // reinstate the row under a different name.
  api.lifecycleHandlers.onEnded(INFO, "nonsense", {});
  assert.deepEqual(posts, [], "no terminal echo may leave this process");
});

test("onEnded STILL posts the calm session-ended milestone — the waiting peer is told", () => {
  const { api, posts } = loadLifecycleEcho();
  api.lifecycleHandlers.onEnded(INFO, "task_progress", { session_ended: true });
  assert.equal(posts.length, 1, "the quit guard's 'went inactive' note depends on this");
  const [entry, m, kind, taskId, meta, body] = posts[0];
  assert.equal(kind, "task_progress", "the MILESTONE lane, never a terminal kind");
  assert.equal(entry.channel.id, "c1");
  assert.equal(taskId, "t1");
  assert.equal(m.seq, "t1#s");
  assert.equal(meta.session_ended, true);
  assert.equal(body, "Session ended");
});

test("C-5 survives: the calm note is said ONCE per (thread, cycle)", () => {
  const { api, posts } = loadLifecycleEcho();
  api.lifecycleHandlers.onEnded(INFO, "task_progress", { session_ended: true });
  api.lifecycleHandlers.onEnded(INFO, "task_progress", { session_ended: true });
  assert.equal(posts.length, 1, "an eviction reaching a held session must not say it twice");
});

// ── WHICH SESSION WROTE IT (2026-09-15, AGENT-BADGE-TRACE.md) ────────────────────────────
//
// THE DEFECT. This note is ABOUT one session and arrived saying nothing about which. The server
// strips a caller-supplied `metadata.session_id` and re-stamps the reserved key ONLY from the
// `X-Dopl-Session-Id` header (`service-writes-metadata.ts` fold 6b), and main's HTTP path never
// set it — so `authorAgentIdOf` answered null, the `channel_sessions.display_name` join was
// never attempted, and every "Session ended" row rendered as the bare noun "Agent" over a
// session the operator had named. Samuel's report: *"a message that says agent ended … the badge
// says just Agent … I'm not sure what's prompting that."*
//
// What is pinned here is the seam: the slot key reaches `postTaskEvent`, and it is the SLOT key
// rather than the per-launch one.

test("the calm note carries the SLOT KEY, so the row can say which agent it is about", () => {
  const { api, posts } = loadLifecycleEcho();
  api.lifecycleHandlers.onEnded(INFO, "task_progress", { session_ended: true });
  const opts = posts[0][6];
  assert.ok(opts, "postTaskEvent's opts is where the header value rides");
  assert.equal(opts.sessionId, "c1:t1", "the key `session-store.js › sessionKey` builds");
});

test("it is `key` and NOT the ephemeral `sessionId` — the reader wants the AGENT segment", () => {
  // `key` is `<channelId>:<taskId>:<agentId>` and survives a park+resume; `sessionId` is minted
  // per launch and carries no agent id at all. Stamping the ephemeral one would produce a header
  // the server accepts and `lib/agent-post-stamp.ts › agentIdOfSessionKey` cannot resolve, which
  // is the same bare "Agent" with a longer chain of custody.
  const { api, posts } = loadLifecycleEcho();
  const info = { ...INFO, key: "c1:t1:deynelz3", sessionId: "sess-EPHEMERAL" };
  api.lifecycleHandlers.onEnded(info, "task_progress", { session_ended: true });
  const { sessionId } = posts[0][6];
  assert.equal(sessionId, "c1:t1:deynelz3");
  assert.ok(!sessionId.includes("EPHEMERAL"), "the per-launch id is never the attribution");
  assert.equal(sessionId.split(":").pop(), "deynelz3", "the agent id is the segment readers take");
});

test("a session with no key stamps NOTHING rather than a value no reader can resolve", () => {
  // ⚠ UNKNOWN IS NOT EMPTY AND IS NOT A GUESS (INVARIANTS §11). The honest rendering of "cannot
  // say which agent" is the bare noun; inventing a key would attribute the post to a session
  // that does not exist.
  const { api, posts } = loadLifecycleEcho();
  api.lifecycleHandlers.onEnded({ ...INFO, key: undefined }, "task_progress", { session_ended: true });
  assert.equal(posts.length, 1, "the note still goes out — attribution is not a precondition");
  assert.equal(posts[0][6].sessionId, undefined);
});
