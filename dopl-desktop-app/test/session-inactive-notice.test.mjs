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
//      ⚠ THAT CALLER IS GONE AND THE RULE IS NOT (2026-08-20, F-228). The eviction existed to
//      reclaim a WINDOW budget and was deleted with the windows, so §3 below is rewritten off
//      its surviving producers rather than off `evictIdleShell`. `inactive` itself is not
//      window machinery: `session-reopen.endLiveSessions` (the quit sweep) and the launch
//      watchdog both still reach it, and both still go through the reducer.
//
// SAMUEL'S DECISION: the waiting person gets a message in the thread saying the session went
// inactive, worded as a STATUS NOTE and not an error — it is nobody's fault.
//
// WHAT THAT MEANS MECHANICALLY, and why it is the existing machinery rather than a new path:
// the note is `task_progress` + the reserved `session_ended` marker, which is the operator-End
// precedent (P1-7). The kind is what makes it non-terminal BY CONSTRUCTION, so it can never
// become the shared thread's outcome; a terminal kind here would paint the exchange as failed
// on the peer's side, which is the exact bug P1-7 was raised to fix for the operator End.
//
// ⚠ THE READER CHANGED UNDER IT, AND THE NOTE DID NOT (wiring plan Phase 5, 2026-08-18). The
// mechanics above used to be spelled in terms of `group-thread.ts` folding a `task_progress`
// into a session CARD's `calmEndStatus`; that whole family is DELETED with the card, and the
// v2 transcript renders the note as an ordinary milestone row instead. What survives is the
// only part that ever mattered here: a `task_progress` cannot be an outcome, and it is the
// ONE lifecycle post this desktop still makes — the three terminal kinds went in the same
// change (trigger-outcomes.js, pinned by lifecycle-echo.test.mjs).
//
// Run: `node --test dopl-desktop-app/test/session-inactive-notice.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const M = (p) => readFileSync(join(MAIN, p), "utf8");
const ECHO_SRC = M("trigger-outcomes.js"); // the lifecycle echo (moved off session-window.js, 2026-08-20)
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

test("the marker stays RESERVED server-side, even though no client reads it any more", () => {
  // ⚠ REWRITTEN, NOT REMOVED (INVARIANTS §14). This case used to also require a
  // `channels/lib` module exporting `SESSION_ENDED_KEY` — the CLIENT read that turned the
  // marker into a card's calm end note. That export lived in `group-thread-markers.ts` and
  // was DELETED with the whole family (wiring plan Phase 5, 2026-08-18); there is no card
  // left to soften, and the v2 transcript shows the note as the milestone row it is.
  //
  // The SERVER half is the half that was ever a security property, and it is untouched:
  // the key stays in the reserved strip list with no client reader, because a caller able
  // to set it could narrate somebody else's session as ended (INVARIANTS §5 — a key stays
  // reserved with no reader only while something still RENDERS it, and the BODY of this
  // note is rendered).
  //
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
  // …and the client-side READ really is gone, rather than moved somewhere unnoticed.
  const libDir = join(HERE, "..", "..", "src", "features", "channels", "lib");
  // ⚠ The DECLARATION, not any mention: `calm-terminal.ts` names the constant in its
  // header precisely to record that it went, and a grep-for-the-string check would read
  // that annotation as a regression.
  const stillDeclared = readdirSync(libDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .some((f) => /export const SESSION_ENDED_KEY\b/.test(readFileSync(join(libDir, f), "utf8")));
  assert.equal(stillDeclared, false, "a client reader coming back means the strip rule is re-argued first");
});

test("the OTHER terminals are untouched — the caps stay terminal, on purpose", () => {
  // A turn/cost cap is this machine REFUSING to continue, not a window being tidied away,
  // and the peer is owed that as an outcome.
  for (const reason of ["turn_cap", "cost_cap"]) {
    assert.equal(endLifecycle(reason).kind, "task_failed", reason);
  }
  assert.equal(endLifecycle("operator").body, "Session ended", "the End keeps its own wording");
  // ⚠ `close_task` is history: thread closing was removed in Phase 4 (2026-08-18) and the
  // reducer branch went with it. `endLifecycle` still answers null for an unknown reason,
  // which is the property worth keeping — an unrecognised terminal posts NOTHING rather
  // than falling back to a claim about the exchange.
  assert.equal(endLifecycle("close_task"), null, "an unknown reason posts nothing");
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

// ── 3. THE `inactive` TERMINAL ───────────────────────────────────────────────────────
// ⚠ RENAMED FROM "THE WINDOW-BUDGET EVICTION" (2026-08-20, F-228). The eviction was a
// WINDOW-budget mechanism — `evictIdleShell` reclaimed the least-recently-used parked SHELL
// when the open-window count hit its cap — and it went with the windows. The reducer event it
// used is NOT window machinery and did not go: `inactive` is still C-5's calm terminal, and it
// still has live dispatchers. What is pinned below is therefore the same rule with its
// surviving producer: whatever reaches this terminal goes through the reducer, so the note is
// posted from ONE place.

test("`inactive`: it goes through the reducer, so the post is the same one, from the same place", () => {
  const r = sessionReducer(parked(), { type: "inactive" });
  const lc = lifecycleOf(r.effects);
  assert.ok(lc);
  assert.equal(lc.body, INACTIVE_NOTE);
  assert.ok(r.effects.some((e) => e.type === "settle"), "and the slot is still freed");
});

test("`inactive`: every producer DISPATCHES it — no module still settles a session by hand", () => {
  // ⚠ REWRITTEN, NOT REMOVED (INVARIANTS §14). This case used to slice `evictIdleShell` out of
  // session-park.js and assert that IT dispatched rather than calling `deps.settleSession`
  // directly — the exact line that bypassed the lifecycle post before C-5. `evictIdleShell` is
  // deleted (F-228), so slicing it now yields the empty string and the assertion fails on
  // absence rather than on the rule. The RULE survives its subject, and is worth more than the
  // one call site was: a bare settle anywhere is teardown with no reducer, therefore no
  // lifecycle effect, therefore a peer left pulsing "Working…" forever.
  //
  // Two halves, because the engine's injection is what made the old bypass possible at all:
  //   (a) session-park cannot settle even if a future evict-shaped path comes back — the
  //       handle is neither used nor supplied. The engine's own bind comment records that
  //       `settleSession` left with the shell-recreate family; this asserts it.
  const ENGINE = M("session-engine.js");
  assert.ok(!/deps\.settleSession\(/.test(PARK), "session-park settles nothing by hand");
  const bind = ENGINE.slice(ENGINE.indexOf("sessionPark.bind({"), ENGINE.indexOf("});", ENGINE.indexOf("sessionPark.bind({")));
  assert.ok(bind.includes("dispatch"), "precondition: the bind object is the one we think it is");
  assert.ok(!/settleSession/.test(bind), "and the engine no longer hands the park lane a settle at all");

  //   (b) the producers that DO reach this terminal go through `deps.dispatch`. Discovered by
  //       grep so a new one cannot be added silently — and asserted non-empty, because a
  //       terminal with no producer left would make the reducer case above vacuous.
  const producers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => /type: 'inactive'/.test(M(f)))
    .sort();
  assert.ok(producers.length > 0, "the calm terminal must still have a producer");
  for (const f of producers) {
    for (const line of M(f).split("\n").filter((l) => l.includes("type: 'inactive'"))) {
      assert.ok(
        /deps\.dispatch\(|dispatch\(s,|return \{ ms:/.test(line),
        `main/${f} reaches the calm terminal without the reducer: ${line.trim()}`
      );
    }
  }
  assert.ok(producers.includes("session-reopen.js"), "the quit sweep is the one that must never bypass it");
});

// ── THE DOUBLE-POST GUARD ────────────────────────────────────────────────────────────
//
// Two of the three can reach the SAME session: a held session is PARKED, and a parked
// untouched shell is precisely what evictIdleShell takes.

const BEGIN = "// ─── BEGIN LIFECYCLE-ECHO-PURE";
const END = "// ─── END LIFECYCLE-ECHO-PURE";
const BLOCK = ECHO_SRC.slice(ECHO_SRC.indexOf(BEGIN), ECHO_SRC.indexOf(END));
for (const banned of ["require(", "electron", "child_process"]) {
  assert.ok(!BLOCK.includes(banned), `LIFECYCLE-ECHO-PURE must not reference ${banned}`);
}
const win = () => new Function(
  `${BLOCK}\n return { echoTargets, firstInactiveNote, MAX_REMEMBERED_ENDS };`
)();
// ⚠ `echoTargets` LOST ITS `kind` ARGUMENT in Phase 5: only ONE kind still reaches it (this
// note), so the P2-9 terminal-collapse branch that needed the kind went with the terminal
// echoes. Calls below pass the info object alone.

const info = (over = {}) => ({
  channelId: "c1", taskId: "t1", key: "c1:t1", sessionId: "sess-A", sdkSessionId: null, ...over,
});

test("GUARD: the same (thread, cycle) says it once", () => {
  const w = win();
  const seq = w.echoTargets(info()).m.seq;
  assert.equal(w.firstInactiveNote("c1", seq), true, "the hold posts");
  assert.equal(w.firstInactiveNote("c1", seq), false, "the eviction that follows does not repeat it");
});

test("GUARD: a genuinely NEW cycle posts again — sign in, run, park, abandon", () => {
  const w = win();
  const first = w.echoTargets(info()).m.seq;
  const second = w.echoTargets(info({ sdkSessionId: "sdk-B" })).m.seq;
  assert.notEqual(first, second, "a resumed query mints its own sdk session id");
  assert.equal(w.firstInactiveNote("c1", first), true);
  assert.equal(w.firstInactiveNote("c1", second), true);
});

test("GUARD: it is keyed on the echo id, so it agrees with the server's own dedupe", () => {
  // channel-post builds clientMsgId as `${kind}-${channelId}-${seq}`; keying the local guard
  // on the same seq means the two agree by construction rather than by coincidence.
  assert.match(M("channel-post.js"), /clientMsgId: \(opts && opts\.clientMsgId\) \|\| `\$\{kind\}-\$\{entry\.channel\.id\}-\$\{m\.seq\}`/);
  const onEnded = ECHO_SRC.slice(ECHO_SRC.indexOf("function onEnded("));
  assert.match(onEnded, /if \(meta\.session_ended === true && !firstInactiveNote\(entry\.channel\.id, m\.seq\)\)/);
  // ⚠ The id is derived BEFORE the guard reads it — a `-1` from a renamed call would make
  // this comparison pass vacuously, so the presence of the derivation is asserted first.
  const derived = onEnded.indexOf("echoTargets(info)");
  assert.notEqual(derived, -1, "onEnded must derive the echo id itself");
  assert.ok(derived < onEnded.indexOf("firstInactiveNote"),
    "the guard reads the DERIVED echo id, not a guess at one");
});

test("GUARD: the ledger is bounded — this tree has been bitten by a set that only grows", () => {
  const w = win();
  for (let i = 0; i < w.MAX_REMEMBERED_ENDS * 3; i += 1) w.firstInactiveNote("c1", `seq-${i}`);
  assert.equal(w.firstInactiveNote("c1", "seq-0"), true, "the oldest entry was released first");
  assert.ok(w.MAX_REMEMBERED_ENDS >= 4 * 2, "and the bound is well above the concurrent sessions a Mac can hold");
});

test("GUARD: it fences ONLY the calm note — a real terminal is never suppressed", () => {
  const onEnded = ECHO_SRC.slice(ECHO_SRC.indexOf("function onEnded("));
  assert.match(onEnded, /meta\.session_ended === true &&/, "the guard is conditioned on the marker");
  // A `task_failed` for a cap or a crash carries no session_ended, so it can never be dropped
  // by this — and its own P2-9 keying already collapses cycles on the server.
  assert.ok(!/firstInactiveNote\(entry\.channel\.id, m\.seq\)\)\) return;[\s\S]{0,40}task_failed/.test(onEnded));
});
