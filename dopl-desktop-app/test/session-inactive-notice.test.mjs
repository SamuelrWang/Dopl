// C-5 — THE THREE TERMINAL STATES THAT POSTED NOTHING NOW SAY THE SESSION WENT INACTIVE.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-5). Every terminal in this machine posts a
// lifecycle event so the requester's card on the OTHER machine stops pulsing "Working…" —
// every one except three:
//   1. THE 12h ABANDONMENT. `endLifecycle('abandoned')` returned null. This is the COMMON
//      path: request -> task_started -> 15min idle -> silent park -> 12h -> silent end. So
//      the ending that happens most often was the one nobody was told about.
//   2. THE Q6 AUTH-PREFLIGHT HOLD. `startSession` returns the held session, so `launch()`
//      answers with a sessionId and `trigger.inboundApproved` takes its SUCCESS branch — with
//      no query ever run, no `task_started`, and nothing at all on the wire.
//   3. THE WINDOW-BUDGET EVICTION. `evictIdleShell` called the engine's `settle()` directly,
//      which is teardown only: no reducer, therefore no lifecycle effect.
//
// SAMUEL'S DECISION: the waiting person gets a message in the thread saying the session went
// inactive, worded as a STATUS NOTE and not an error — it is nobody's fault.
//
// WHAT THAT MEANS MECHANICALLY, and why it is the existing machinery rather than a new path:
// the note is `task_progress` + the reserved `session_ended` marker, which is the operator-End
// precedent (P1-7). `group-thread.ts` treats `task_progress` as an ENTRY and NEVER as an
// `endEvent`, so the marker can only ever reach `calmEndStatus` on the card that is pulsing —
// it stops the card claiming work is in progress and it CANNOT become the shared thread's
// outcome. A terminal kind here would paint the exchange as failed on the peer's card, which
// is the exact bug P1-7 was raised to fix for the operator End.
//
// Run: `node --test dopl-desktop-app/test/session-inactive-notice.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const WINDOW_SRC = M("session-window.js");
const PARK = M("session-park.js");

const {
  initialSessionState, sessionReducer, endLifecycle, endEffects, parkEffects, INACTIVE_NOTE,
} = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const parked = (opts) => sessionReducer(running(opts), { type: "idle_timeout" }).state;
const lifecycleOf = (effects) => effects.find((e) => e.type === "lifecycle") || null;

// ── THE MESSAGE ──────────────────────────────────────────────────────────────────────

test("the note is a STATUS, not an outcome: task_progress + the calm session_ended marker", () => {
  for (const reason of ["abandoned", "inactive"]) {
    const lc = endLifecycle(reason);
    assert.ok(lc, `${reason} must post`);
    assert.equal(lc.kind, "task_progress", "a terminal kind would paint the SHARED thread failed");
    assert.deepEqual(lc.extra, { session_ended: true });
    assert.equal(lc.body, INACTIVE_NOTE);
  }
});

test("the copy is a status note and not a fault — nobody is blamed and nothing is diagnosed", () => {
  assert.equal(INACTIVE_NOTE, "This session went inactive.");
  assert.ok(!/—/.test(INACTIVE_NOTE), "no em dash in copy");
  assert.ok(!/error|fail|crash|problem|sorry/i.test(INACTIVE_NOTE), INACTIVE_NOTE);
  // It says nothing about WHY, deliberately: which of the three it was is a fact about the
  // other operator's machine (nobody came back / no Claude Code credential / a reclaimed
  // window), and two of those three would be reporting their circumstances to a counterparty.
  assert.ok(!/sign|credential|window|budget|abandon|evict/i.test(INACTIVE_NOTE), INACTIVE_NOTE);
});

test("the marker is one `group-thread` can only read as a status, and the server reserves it", () => {
  // Found by CONTENT, not by path — same reason as the server lookup below, and for the
  // same reason it has now been earned twice: `group-thread.ts` was split (2026-08-08) and
  // the reserved markers DECLARE themselves in `group-thread-markers.ts`, re-exported from
  // `group-thread.ts` so no importer changed. The assertion follows the constant.
  const libDir = join(HERE, "..", "..", "src", "features", "channels", "lib");
  const GROUP = readdirSync(libDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(libDir, f), "utf8"))
    .find((src) => /export const SESSION_ENDED_KEY = "session_ended";/.test(src));
  assert.ok(GROUP, "no channels/lib module declares SESSION_ENDED_KEY");
  // Found by CONTENT, not by path: the server file that owns CALM_FLAG_KEYS has already been
  // split once (`service-writes-metadata-markers.ts`), and a reserved-key assertion that dies
  // on a rename is an assertion that gets deleted rather than repointed.
  const serverDir = join(HERE, "..", "..", "src", "features", "channels", "server");
  const owner = readdirSync(serverDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(serverDir, f), "utf8"))
    .find((src) => src.includes("CALM_FLAG_KEYS = ["));
  assert.ok(owner, "no server module declares CALM_FLAG_KEYS");
  assert.match(owner, /"session_ended",/, "reserved server-side, so a peer cannot forge it");
});

test("the OTHER terminals are untouched — the caps stay terminal, on purpose", () => {
  // A turn/cost cap is this machine REFUSING to continue, not a window being tidied away,
  // and the peer is owed that as an outcome.
  for (const reason of ["turn_cap", "cost_cap"]) {
    assert.equal(endLifecycle(reason).kind, "task_failed", reason);
  }
  assert.equal(endLifecycle("operator").body, "Session ended", "the End keeps its own wording");
  assert.equal(endLifecycle("close_task"), null, "close_task posts its own kind elsewhere");
  assert.equal(endLifecycle("idle_timeout"), null, "an idle PARK is not terminal and posts nothing");
});

// ── 1. THE 12h ABANDONMENT ───────────────────────────────────────────────────────────

test("ABANDONMENT: the common silent path now tells the person still waiting", () => {
  const r = sessionReducer(parked(), { type: "abandon_timeout" });
  const lc = lifecycleOf(r.effects);
  assert.ok(lc, "the requester's card must stop pulsing Working…");
  assert.equal(lc.body, INACTIVE_NOTE);
  assert.ok(r.effects.some((e) => e.type === "settle" && e.outcome === "ended"));
});

test("ABANDONMENT: the note comes BEFORE the settle, so it posts from a live session object", () => {
  const effects = endEffects(parked(), "ended", "abandoned").map((e) => e.type);
  assert.deepEqual(effects, ["abortQuery", "lifecycle", "emit", "settle"]);
});

test("ABANDONMENT: M2b's kept window is unchanged — the note did not cost the transcript", () => {
  const settle = endEffects(parked(), "ended", "abandoned").find((e) => e.type === "settle");
  assert.equal(settle.keepWindow, true, "an abandonment still keeps its painted transcript");
  const other = endEffects(running(), "ended", "operator").find((e) => e.type === "settle");
  assert.equal(other.keepWindow, false);
});

// ── 2. THE AUTH-PREFLIGHT HOLD ───────────────────────────────────────────────────────

test("AUTH HOLD: the park that runs no query at all now posts the same note", () => {
  const r = sessionReducer(running(), { type: "auth_hold" });
  const lc = lifecycleOf(r.effects);
  assert.ok(lc, "nothing else on this path ever reaches the wire");
  assert.equal(lc.kind, "task_progress");
  assert.equal(lc.body, INACTIVE_NOTE);
});

test("AUTH HOLD: it is IDEMPOTENT, so a converging second hold cannot post twice", () => {
  // session-auth.holdIfAuthFailure re-dispatches the hold deliberately (H1(b)) to guarantee a
  // session that a wake dragged back to 'running' ends up parked. The reducer answers with no
  // effects at all once `authHeld` is set, which is what makes that convergence free.
  const held = sessionReducer(running(), { type: "auth_hold" }).state;
  assert.deepEqual(sessionReducer(held, { type: "auth_hold" }).effects, []);
});

test("AUTH HOLD: the IDLE park still posts NOTHING — it is a pause, not an ending", () => {
  // An idle park is fifteen minutes the operator is expected back from, and its own
  // abandonment bound is what speaks if they are not. Posting here would narrate every lunch
  // break into the shared thread.
  assert.equal(lifecycleOf(sessionReducer(running(), { type: "idle_timeout" }).effects), null);
  assert.equal(lifecycleOf(parkEffects(running(), { resetPosture: false, armAbandon: true })), null);
  assert.ok(lifecycleOf(parkEffects(running(), { lifecycle: true })), "only the flagged park posts");
});

// ── 3. THE WINDOW-BUDGET EVICTION ────────────────────────────────────────────────────

test("EVICTION: it goes through the reducer, so the post is the same one, from the same place", () => {
  const r = sessionReducer(parked(), { type: "inactive" });
  const lc = lifecycleOf(r.effects);
  assert.ok(lc);
  assert.equal(lc.body, INACTIVE_NOTE);
  assert.ok(r.effects.some((e) => e.type === "settle"), "and the slot is still freed");
});

test("EVICTION: the bare settle() call is GONE from session-park — one path, not two", () => {
  const evict = PARK.slice(PARK.indexOf("function evictIdleShell()"));
  assert.match(evict, /deps\.dispatch\(victim, \{ type: 'inactive' \}\)/);
  assert.ok(!/deps\.settleSession\(/.test(evict),
    "a direct settle here is exactly what bypassed the lifecycle post");
});

// ── THE DOUBLE-POST GUARD ────────────────────────────────────────────────────────────
//
// Two of the three can reach the SAME session: a held session is PARKED, and a parked
// untouched shell is precisely what evictIdleShell takes.

const BEGIN = "// ─── BEGIN SESSION-WINDOW-PURE";
const END = "// ─── END SESSION-WINDOW-PURE";
const BLOCK = WINDOW_SRC.slice(WINDOW_SRC.indexOf(BEGIN), WINDOW_SRC.indexOf(END));
for (const banned of ["require(", "electron", "child_process"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-WINDOW-PURE must not reference ${banned}`);
}
const win = () => new Function(
  `${BLOCK}\n return { echoTargets, firstInactiveNote, MAX_REMEMBERED_ENDS };`
)();

const info = (over = {}) => ({
  channelId: "c1", taskId: "t1", key: "c1:t1", sessionId: "sess-A", sdkSessionId: null, ...over,
});

test("GUARD: the same (thread, cycle) says it once", () => {
  const w = win();
  const seq = w.echoTargets(info(), "task_progress").m.seq;
  assert.equal(w.firstInactiveNote("c1", seq), true, "the hold posts");
  assert.equal(w.firstInactiveNote("c1", seq), false, "the eviction that follows does not repeat it");
});

test("GUARD: a genuinely NEW cycle posts again — sign in, run, park, abandon", () => {
  const w = win();
  const first = w.echoTargets(info(), "task_progress").m.seq;
  const second = w.echoTargets(info({ sdkSessionId: "sdk-B" }), "task_progress").m.seq;
  assert.notEqual(first, second, "a resumed query mints its own sdk session id");
  assert.equal(w.firstInactiveNote("c1", first), true);
  assert.equal(w.firstInactiveNote("c1", second), true);
});

test("GUARD: it is keyed on the echo id, so it agrees with the server's own dedupe", () => {
  // channel-post builds clientMsgId as `${kind}-${channelId}-${seq}`; keying the local guard
  // on the same seq means the two agree by construction rather than by coincidence.
  assert.match(M("channel-post.js"), /clientMsgId: \(opts && opts\.clientMsgId\) \|\| `\$\{kind\}-\$\{entry\.channel\.id\}-\$\{m\.seq\}`/);
  const onEnded = WINDOW_SRC.slice(WINDOW_SRC.indexOf("function onEnded("));
  assert.match(onEnded, /if \(meta\.session_ended === true && !firstInactiveNote\(entry\.channel\.id, m\.seq\)\)/);
  assert.ok(onEnded.indexOf("echoTargets(info, k)") < onEnded.indexOf("firstInactiveNote"),
    "the guard reads the RESOLVED echo id, not a guess at one");
});

test("GUARD: the ledger is bounded — this tree has been bitten by a set that only grows", () => {
  const w = win();
  for (let i = 0; i < w.MAX_REMEMBERED_ENDS * 3; i += 1) w.firstInactiveNote("c1", `seq-${i}`);
  assert.equal(w.firstInactiveNote("c1", "seq-0"), true, "the oldest entry was released first");
  assert.ok(w.MAX_REMEMBERED_ENDS >= 6 * 2, "and the bound is well above the six windows a Mac can hold");
});

test("GUARD: it fences ONLY the calm note — a real terminal is never suppressed", () => {
  const onEnded = WINDOW_SRC.slice(WINDOW_SRC.indexOf("function onEnded("));
  assert.match(onEnded, /meta\.session_ended === true &&/, "the guard is conditioned on the marker");
  // A `task_failed` for a cap or a crash carries no session_ended, so it can never be dropped
  // by this — and its own P2-9 keying already collapses cycles on the server.
  assert.ok(!/firstInactiveNote\(entry\.channel\.id, m\.seq\)\)\) return;[\s\S]{0,40}task_failed/.test(onEnded));
});
