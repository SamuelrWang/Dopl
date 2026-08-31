// Tests for the session-reopen helpers (main/session-reopen.js) — the MAIN-window bridge onto
// ONE OF MY OWN AGENTS: open a VIEW on it (`reopenByTask`) and talk to it (`messageByTask`).
// That the bridge starts NOTHING is pinned separately in test/open-session-no-query.test.mjs.
//
// ⚠ REWRITTEN DOWN TO WHAT SURVIVES (2026-08-20, F-228), NOT REMOVED — INVARIANTS §14. The v1
// session-window model is deleted: agents run WINDOWLESS on the SDK engine, `s.win` is null, and
// `reopenWindow` / `showLive` / the `keptWindow` branch / the `recreateParkedShell` fallback all
// went with it. Eleven cases in this file were about those four things and are gone; each one is
// replaced in place by a ⚠ block naming what stood there and what it pinned. FIVE more were
// written when a windowless session's answer was a REFUSAL and the answer is now the agent
// window — those are REWRITTEN to the new contract, not deleted, and say so at the case.
//
// SOURCE EXTRACTION with INJECTION (the session-dispatch idiom): the BEGIN/END
// SESSION-REOPEN-PURE block references `store` and `framing` (module requires) as free vars and
// declares its own `deps` (set by bind). We slice the block, prove it is electron/require-free,
// inject fakes for the two free vars, and bind fake engine internals.
//
// Run: `node --test dopl-desktop-app/test/session-reopen.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-reopen.js"), "utf8");
// The REAL operator-turn delimiter, injected like `store` — the 1:1 lane's cases are about
// the delimiting a turn actually gets, and a stub would let the two drift apart.
const framing = createRequire(import.meta.url)(join(HERE, "..", "main", "session-seed.js"));
// ⚠ THE REAL `session-private.js` (2026-08-22), not a stub: `messageByTask` OPENS the
// private-turn window before dispatching, and the DEPTH it opens with depends on whether a turn
// is already in flight. A fake would let this suite go green over a window covering the wrong
// turn — the one bug the depth exists to prevent.
const privateTurn = createRequire(import.meta.url)(join(HERE, "..", "main", "session-private.js"));
const directedTurn = createRequire(import.meta.url)(join(HERE, "..", "main", "session-directed.js"));
// ⚠ THE REAL AXIS-B FLOOR, injected for the same reason (2026-08-20, F-236). `setModeByTask`
// clamps a windowless session's message axis, and a stub would let this suite pass over a
// clamp that does not match the one lane the launch path uses. Its own rules live in
// `test/session-mode-floor.test.mjs`; here it is a real dependency, not a subject.
const { floorWindowlessMessage } = createRequire(import.meta.url)(
  join(HERE, "..", "main", "session-profiles.js")
);

const BEGIN = "// ─── BEGIN SESSION-REOPEN-PURE";
const END = "// ─── END SESSION-REOPEN-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-REOPEN-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-REOPEN-PURE sentinel missing");
assert.ok(to > from, "session-reopen sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-REOPEN-PURE block must not reference ${banned}`);
}

// ⚠ THE KEY GAINED AN AGENT SEGMENT ON 2026-08-21 (`main/session-store.js#sessionKey`): a
// thread holds N of the operator's agents, so (channel, thread) addresses a GROUP. Every case
// below registers ONE agent and calls the ops without naming it, which exercises the
// COMPATIBILITY half of the resolution rule — an unnamed op takes the oldest live agent on the
// thread, exactly what a caller got when a thread could hold only one.
const AGENT = "a1b2c3d4";
const KEY = `chan-1:task-9:${AGENT}`;

/**
 * A live session object as the engine's registry really holds one SINCE THE RETIREMENT:
 * registered, unsettled, and `win` NEVER ASSIGNED (`session-windowless.js › attachSurface`).
 *
 * ⚠ `win` USED TO BE THE POINT OF THIS FIXTURE and is now absent by default. The old version
 * built a fake BrowserWindow and counted `show()` / `focus()`, because `reopenByTask`'s first
 * branch revealed a live session's own window. There is no such branch and no such window; a
 * case that still wants one passes it explicitly, and exactly one below does — deliberately.
 */
function fakeSession(over = {}) {
  // ⚠ `operatorUserId` (2026-08-31): the cross-account stamp `startSession` now writes. The
  // PRIVATE DIRECT LANE refuses a session whose stamp does not match the direction's operator,
  // because the registry outlives a sign-out.
  return {
    key: KEY, agentId: AGENT, sessionId: "s-1", settled: false, win: null, context: {},
    operatorUserId: "op-1", ...over,
  };
}

/**
 * ⚠ A SCAFFOLD STOOD HERE AND HAS EXPIRED, WHICH IS THE POINT OF RECORDING IT.
 *
 * The F-228 sweep rebuilt `session-reopen.js › bind`'s `deps` literal and dropped
 * `openAgentWindow` from it, so the handle `session-engine.js` passes was discarded and
 * `reopenByTask` hit its own fail-closed guard on EVERY live session — the Agents tab's "Open
 * window" answering `{ ok: false }` in production, indistinguishable from a session that is
 * legitimately unopenable. This file caught it, tested the branch behind `bind` through a shim,
 * and carried a self-expiring HANDOFF case that failed the moment `bind` was fixed.
 *
 * ⚠ THE LESSON IS THE LITERAL, NOT THE FIELD: `bind` REBUILDS `deps` rather than merging into
 * it, so an omitted handle is dropped silently AND the drop wears the same face as the guard
 * firing correctly. `bind`'s own docblock now says so. The cases below go through `bind` the
 * ordinary way.
 */
function harness(over = {}) {
  const cfg = { openAgentWindow: null, ...over };
  const calls = { refreshTray: 0, dispatch: [], opened: [] };
  const store = {
    sessionKey: (c, t, a) => `${c}:${t}:${a || ""}`,
    slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
    threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:`,
  };
  const api = new Function(
    "store",
    "framing",
    "floorWindowlessMessage",
    "privateTurn",
    // ⚠ `directedTurn` JOINED ON 2026-08-31 (the private direct lane): `messageByTask`
    // now reads a DIRECTION off its argument and, when there is one, frames it as DATA
    // and arms the reply capture. The REAL module — it is pure, and the branch it
    // drives is the behaviour.
    "directedTurn",
    `${BLOCK}\n return { bind, resolveSession, listLiveSessions, reopenByTask, controlByTask, setModeByTask, messageByTask,
       listOrphanRisk, endLiveSessions };`
  )(store, framing, floorWindowlessMessage, privateTurn, directedTurn);
  const sessions = new Map();
  // ⚠ The REAL `frameOperatorTurn` is injected, not a stub: the MESSAGE cases are about the
  // delimiting the operator's turn actually gets, and a stub would let the two drift.
  const dispatch = (s, event) => { calls.dispatch.push([s, event]); };
  api.bind({
    sessions,
    refreshTray: () => { calls.refreshTray++; },
    dispatch,
    openAgentWindow: cfg.openAgentWindow
      ? (t) => { calls.opened.push(t); return cfg.openAgentWindow(t); }
      : null,
  });
  return { ...api, sessions, calls };
}

const task = { channelId: "chan-1", taskId: "task-9" };

// ⚠ "reopenByTask shows the window of a LIVE (parked) session (no fallback)" STOOD HERE.
// It pinned that a live session's OWN BrowserWindow was `show()`n and `focus()`ed and that
// `s.windowHidden` was cleared, in preference to rebuilding anything. Gone with the window: a
// live session has no `win`, `windowHidden` is never set, and `reopenByTask`'s live branch now
// opens `main/agent-window.js` instead. Its replacement is the OPEN section below.

// ⚠ FOUR CASES OF THE v1.7.4 P2 `recreateParkedShell` FALLBACK STOOD HERE:
//   • "P2 fallback: no live session delegates to recreateParkedShell" — and pinned the Q6b CLICK
//     marker `{ channelId, taskId, fromChannel: true }`, the one caller allowed to build a shell
//     for a thread with no local durable record;
//   • "P2 fallback: recreateParkedShell can return {ok:false} for a truly-closed task";
//   • "no live session AND no fallback bound -> {ok:false} (mid-wave safety)";
//   • "a settled or destroyed session falls through to the fallback (not shown)".
// `recreateParkedShell` is DELETED from `main/session-park.js` with the rest of the v1 shell
// machinery, so there is no fallback and nothing to delegate to. ⚠ THE LIVE RESIDUE OF ALL FOUR
// — that a key resolving to nothing, or to something settled, REFUSES rather than inventing a
// session — is not lost: it is the two REFUSE cases below, and it is the same
// `{ ok: false, reason: 'no-session' }` shape `controlByTask` and `messageByTask` return.
// ⚠ It is worth recording WHY the fallback died rather than only that it did. Its first line
// answered `{ ok: true }` for a live session it had not rebuilt, so the button reported success
// having opened nothing — the swallow F-212 was filed about.

// ⚠ THE §3.3 "ENDED SESSION WHOSE WINDOW SURVIVED" SECTION STOOD HERE — five cases and the
// `keptWin()` helper they shared:
//   • "an ENDED session's kept window is shown, and the recreate is NOT reached";
//   • "a LIVE session still wins over a kept one for the same slot";
//   • "a kept window the operator CLOSED falls through to the recreate";
//   • "an unwired keptWindow changes nothing (mid-wave engine)";
//   • "reopenWindow shows a hidden live window by internal sessionId".
// The first four pinned the abandonment bargain: an end nobody watched happen left its window
// OPEN so the transcript did not vanish, and clicking Open landed in THAT window rather than
// minting a fresh shell over the top of it. `main/session-summary.js › keptWindow` — the lookup
// that branch called — is deleted, so nothing is retained and nothing can be revealed. The
// fifth went with the tray's "Sessions" submenu, which was `reopenWindow(sessionId)`'s only
// caller and is itself gone.
// ⚠ The PILL half of that bargain is NOT dead and is not this file's: `noteEnded` / `sweepEnded`
// still run and are pinned in `session-summary.test.mjs` §4 — read the ⚠ block over that section
// before assuming the retention went with the window.

// ── THE ONE REOPEN PATH: A LIVE SESSION OPENS THE AGENT WINDOW ───────────────────
//
// ⚠ THIS BLOCK PINNED THE OPPOSITE BEHAVIOUR UNTIL 2026-08-20, AND THE REPLACEMENT IS THE POINT.
// The original defect was that a live WINDOWLESS session — which is now every session — fell
// through to `recreateParkedShell`, whose first line answers `{ ok: true }` for an existing
// session. The button reported success having opened nothing.
//
// The first fix made that honest: `{ ok: false, reason: 'windowless' }`, worded in the panel as
// "this agent runs without a window". Samuel called that meaningless, correctly — **a window is
// a VIEW, not a runtime property.** Whether main minted a BrowserWindow for a spawn is an
// implementation detail of the spawn shape and is no answer to "show me my agent". So the
// refusal is gone and the view exists (`main/agent-window.js`).
//
// The lesson these cases now carry: an honest refusal is only worth shipping when the operator
// can DO something with it. Reporting an internal reason beats silence and is not a substitute
// for the feature.

// THE PRIVATE DIRECT LANE, THROUGH THE REAL `messageByTask` (Samuel's ruling, 2026-08-31).
//
// ⚠ **ITS OWN FILE, AND THE SEAM IS A REASON TO CHANGE RATHER THAN THE LINE COUNT THAT FORCED
// THE QUESTION** (§1). `session-reopen.test.mjs` is about the RENDERER'S OPS on a live session —
// open, control, set-mode, set-model, and the operator's own 1:1 message — and changes when one
// of those moves. This file is about WHO IS SPEAKING and what that buys them, and changes when
// the direction lane's rulings move. They were one file and every direction fix re-opened the
// whole ops suite for review.
//
// ⚠ IT SHARES THAT FILE'S HARNESS VERBATIM, deliberately: both drive the SESSION-REOPEN-PURE
// block with the REAL `session-seed.js`, the REAL `session-private.js` and the REAL
// `session-directed.js`, because the framing a turn actually gets, the depth the window actually
// opens with, and the capture that actually arms are the subjects — a stub anywhere would let
// this suite go green over a turn that ran ungated.
//
// THE PROPERTIES, all of them found or confirmed by the 2026-08-31 adversarial review:
//  - 🔒 A direction is FENCED AS DATA and never carries operator authority (the lane's core
//    ruling), pinned AT THE CALL SITE — asserting the two framers differ is not the same pin.
//  - 🔒 A direction reaches only a session THIS operator started (F-373). The registry outlives
//    a sign-out, so the signed-in user alone is not the answer.
//  - 🔒 The private window is opened AFTER the dispatch (F-372), because a `steer` at a PARKED
//    session wakes it and the wake RESETS the window that was just opened.
//  - A direction must NAME ITS AGENT; there is no oldest-agent fallback on this lane.
//  - The operator's own message is untouched by all of it.

// ── THE PRIVATE DIRECT LANE (2026-08-31) — the SAME op, a different SPEAKER ──────────────

test("DIRECTION: 🔒 it is FENCED AS DATA and carries NO operator authority", () => {
  // 🔒 **THE LOAD-BEARING RULING OF THE WHOLE LANE, PINNED AT THE CALL SITE RATHER THAN ON THE
  // TWO FUNCTIONS.** A direction is text ANOTHER AGENT wrote, produced by a process holding a
  // 90-day device token. Framing it as the OPERATOR speaking would hand the highest authority in
  // the system to the lane with the weakest human in it — the 2026-08-01 incident's exact shape.
  // ⚠ Asserting that `frameDirectedTurn` DIFFERS from `frameOperatorTurn` is not this pin: a
  // caller that reached for the wrong one would leave both functions perfectly correct.
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123" }));
  h.messageByTask({
    ...task, agentId: AGENT, text: "audit the deploy",
    directed: { id: "d-1", workspaceId: "w", operatorUserId: "op-1" },
  });
  const [, event] = h.calls.dispatch[0];
  assert.match(event.text, /ANOTHER OF YOUR OPERATOR'S AGENTS is directing you/);
  assert.match(event.text, /do NOT carry your operator's authority/);
  assert.equal(/YOUR OPERATOR is speaking to you directly/.test(event.text), false,
    "a direction must never be framed as the operator speaking");
  assert.match(event.text, /BEGIN-DIRECTION-abc123/);
  assert.equal(/BEGIN-OPERATOR-abc123/.test(event.text), false);
});

test("DIRECTION: the OPERATOR's own message is untouched by the lane", () => {
  // ⚠ The other half of the same pin: every pre-existing caller keeps the operator framing.
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123" }));
  h.messageByTask({ ...task, text: "hello" });
  const [, event] = h.calls.dispatch[0];
  assert.match(event.text, /YOUR OPERATOR is speaking to you directly/);
  assert.equal(/ANOTHER OF YOUR OPERATOR'S AGENTS/.test(event.text), false);
  assert.equal(event.directed, false);
});

test("DIRECTION: it is TAGGED for the narration lane, so the operator can tell the two apart", () => {
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123" }));
  h.messageByTask({ ...task, agentId: AGENT, text: "x", directed: { id: "d-1", workspaceId: "w", operatorUserId: "op-1" } });
  const [, event] = h.calls.dispatch[0];
  assert.equal(event.directed, true);
  assert.equal(event.private, true, "it is still a PRIVATE turn — the gate is unchanged");
});

test("DIRECTION: it opens the SAME private window, so an accidental public reply stays impossible", () => {
  const h = harness();
  const s = fakeSession({ nonce: "abc123" });
  h.sessions.set(KEY, s);
  h.messageByTask({ ...task, agentId: AGENT, text: "x", directed: { id: "d-1", workspaceId: "w", operatorUserId: "op-1" } });
  assert.ok(privateTurn.isPrivateTurn(s), "the outbound widening is withdrawn for this turn");
});

test("DIRECTION: 🔒 one from a DIFFERENT operator cannot reach this session", () => {
  // 🔒 **THE CROSS-ACCOUNT FENCE (adversarial review, 2026-08-31).** The engine's registry is
  // process-lifetime and a SIGN-OUT DOES NOT CLEAR IT, so operator A's live agent survives B
  // signing in on the same Mac. Gate 3 in `agent-directions.js` compares the row to the
  // CURRENTLY signed-in user, which is B — so without this check B's direction would reach A's
  // session and ship A's private turn text back to B's row, in the one column that leaves the
  // machine. Same guard, same reason, as `session-state-push.js › trackOrigin`.
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123", operatorUserId: "op-A" }));
  const out = h.messageByTask({
    ...task, agentId: AGENT, text: "x",
    directed: { id: "d-1", workspaceId: "w", operatorUserId: "op-B" },
  });
  assert.deepEqual(out, { ok: false, reason: "no-session" });
  assert.equal(h.calls.dispatch.length, 0);
});

test("DIRECTION: 🔒 an UNSTAMPED session refuses — the fence fails closed", () => {
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123", operatorUserId: undefined }));
  const out = h.messageByTask({
    ...task, agentId: AGENT, text: "x",
    directed: { id: "d-1", workspaceId: "w", operatorUserId: "op-1" },
  });
  assert.deepEqual(out, { ok: false, reason: "no-session" });
});

test("DIRECTION: the OPERATOR's own message is unaffected by the stamp", () => {
  // ⚠ The fence is on the DIRECTED path only: the composer's own message is the operator at
  // their own keyboard, in a window main created, and has never been owner-checked here.
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123", operatorUserId: "op-A" }));
  assert.deepEqual(h.messageByTask({ ...task, text: "hello" }), { ok: true });
});

test("DIRECTION: 🔒 one that NAMES NO AGENT is refused, and dispatches nothing", () => {
  // 🔒 There is no oldest-agent fallback on a lane that reaches a PRIVATE turn: it would steer
  // an agent the orchestrator did not address, with nothing reporting the swap.
  const h = harness();
  h.sessions.set(KEY, fakeSession({ nonce: "abc123" }));
  const out = h.messageByTask({
    ...task, agentId: "", text: "x", directed: { id: "d-1", workspaceId: "w", operatorUserId: "op-1" },
  });
  assert.deepEqual(out, { ok: false, reason: "no-session" });
  assert.equal(h.calls.dispatch.length, 0);
});
