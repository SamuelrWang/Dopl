// THE ENDED RETENTION RULE (main/session-summary.js › noteEnded / sweepEnded / MAX_ENDED).
//
// ⚠ ITS OWN FILE SINCE 2026-08-20 (F-226 + F-234, in the same change). It was §4 of
// `session-summary.test.mjs`, which stood at EXACTLY 500 lines — so the rule could not gain a
// case, and the F-234 rewrite needed several. That is the cap doing test-suite architecture by
// accident, which F-226 says to stop doing under time pressure: the seam was already visible
// (`session-summary-shape.test.mjs` and `session-summary-report.test.mjs` came off the same
// harness for the same reason), so it is taken deliberately here.
//
// ── WHAT THE RULE IS NOW, AND WHAT IT WAS ────────────────────────────────────────────
// A session that ENDS may leave its pill behind on the Agents tab, so an operator who was not
// watching still has a record that the run happened.
//
// It USED to retain on `keepWindow === true && windowAlive(s.win)` — the window was the clock,
// and a pill survived exactly as long as a transcript somebody could still be looking at.
// ⚠ EVERY SESSION HAS BEEN WINDOWLESS SINCE THE F-228 RETIREMENT, so `s.win` was null on all of
// them, the second conjunct was false on every end, and `endedKept` COULD NOT GAIN A ROW. The
// retention rule had silently become a no-op — an agent that finished vanished from the tab
// instantly — and the rule exists precisely for the case it had stopped covering.
//
// ⚠ SAMUEL'S RULING (2026-08-20, F-234): RETAIN UNCONDITIONALLY, BOUNDED BY `MAX_ENDED`. A time
// bound was the obvious alternative and was refused — the question the window check answered
// ("did anything ever have this on screen") has no answer without a window, and a TTL would
// have invented one. A count bound is honest about being a count.
//
// ⚠ THE COST THE RULING ACCEPTED, PINNED BELOW SO IT CANNOT BE FORGOTTEN: a retained pill is a
// TOMBSTONE, not a HANDLE. `session-reopen.js › reopenByTask` refuses a settled key, so
// clicking one opens nothing. That is deliberate; a click that minted a fresh shell wearing a
// dead session's name is the failure the old rule was avoiding, and refusing is the honest
// version of it.
//
// ⚠ NO FAKE WINDOW ANYWHERE IN THIS FILE, AND THAT IS THE POINT. The old §4 drove the predicate
// through `fakeWindow()` because the source was live while the engine could no longer reach it
// — the tests passed over a rule production could not run. Retention now takes ONE input, the
// caller's flag, and every case below drives it the way the engine does.
//
// Run: `node --test dopl-desktop-app/test/session-summary-retention.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAIN, load, session } from "./_session-summary-harness.mjs";

const SUMMARY = readFileSync(join(MAIN, "session-summary.js"), "utf8");
const ENGINE = readFileSync(join(MAIN, "session-engine.js"), "utf8");

// ── The rule ─────────────────────────────────────────────────────────────────────────

test("ENDED: a retained end keeps its PILL, as `ended`, under the same key", () => {
  const m = load();
  assert.equal(m.noteEnded(session(), true), true,
    "the return value is the engine's receipt for the retention");
  const rows = m.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "ended");
  assert.equal(rows[0].taskId, "task-1");
});

test("ENDED: a WINDOWLESS session retains — the case the old predicate could not reach", () => {
  // ⚠ THE F-234 REGRESSION CASE, AND THE ONLY ONE THAT WOULD HAVE CAUGHT IT. Every session the
  // engine settles has `win: null` (session-engine.js › startSession). Under the old rule
  // `windowAlive(null)` was false, so this returned false and the tab lost the run. Driving a
  // session with NO window is what makes this suite about production rather than about a fake.
  const m = load();
  const s = session();
  s.win = null;
  assert.equal(m.noteEnded(s, true), true, "no window is not a reason to drop the record");
  assert.equal(m.list().length, 1, "the pill is there for an operator who was not watching");
  assert.equal(m.list()[0].state, "ended");
});

test("ENDED: an end that asks for no retention keeps no pill", () => {
  const m = load();
  // The engine asks only for the ABANDONMENT; operator End, turn/cost cap, completed and crash
  // all pass false, and those are ends somebody chose or watched.
  assert.equal(m.noteEnded(session(), false), false);
  assert.deepEqual(m.list(), [], "an end the operator drove needs no tombstone");
});

test("ENDED: the flag is the WHOLE predicate — a dead window no longer suppresses it", () => {
  // ⚠ THE DELETED CONJUNCT, PINNED AS AN ABSENCE. `noteEnded` must not consult a window at all;
  // a session object still carrying a destroyed one (a harness, an older record) retains
  // exactly like every other. Asserting the behaviour rather than the source, so a
  // reintroduced check fails here whichever way it is spelled.
  const m = load();
  const s = session();
  s.win = { isDestroyed: () => true };
  assert.equal(m.noteEnded(s, true), true);
  assert.equal(m.list().length, 1);
});

test("ENDED: reopening the thread replaces the ended pill rather than doubling it", () => {
  const m = load();
  m.noteEnded(session(), true);
  // The operator reopens that thread: a live session takes the same (channel, thread) slot.
  m.bind({ sessions: new Map([["chan-1:task-1", session({ sessionId: "sess-live" })]]) });
  const rows = m.list();
  assert.equal(rows.length, 1, "one slot, one pill");
  assert.equal(rows[0].sessionId, "sess-live");
  assert.equal(rows[0].state, "working", "the LIVE session is the one the pill should open");
});

test("ENDED: MAX_ENDED is the only bound, and it drops the OLDEST", () => {
  // ⚠ THIS IS NOW THE WHOLE OF THE BOUND. It used to be a belt over a rule that swept itself
  // (an entry lived only while its window did); with that gone, an unbounded set would grow
  // for the life of the process, and every per-session bound is multiplicative against it.
  const m = load();
  for (let i = 0; i < m.MAX_ENDED + 5; i += 1) {
    m.noteEnded(session({ taskId: `t-${i}`, sessionId: `s-${i}` }), true);
  }
  const rows = m.list();
  assert.equal(rows.length, m.MAX_ENDED);
  assert.equal(rows[0].taskId, "t-5", "the oldest go — least likely to still matter");
});

test("ENDED: retention survives repeated projections (no sweep can empty it)", () => {
  // The old `sweepEnded` filtered on `windowAlive` at EVERY projection, so a retained row
  // could disappear between two reads with nothing having ended. Nothing prunes now except
  // the count bound, and a projection must be idempotent.
  const m = load();
  m.noteEnded(session(), true);
  assert.equal(m.list().length, 1);
  assert.equal(m.list().length, 1, "a second read must not sweep the first read's row");
  assert.equal(m.list().length, 1);
});

// ── The two things the ruling deliberately did NOT buy ───────────────────────────────

test("a retained pill is a TOMBSTONE: nothing in main/ tries to reveal a window for it", () => {
  // ⚠ THE ACCEPTED COST, ASSERTED. `keptWindow` was the lookup `reopenByTask` cashed a pill in
  // with; it is deleted (F-228) and must not come back on the strength of retention working
  // again. A retained key is SETTLED, so `reopenByTask` answers `{ok:false, reason:'no-session'}`
  // — the Agents tab words that refusal.
  assert.equal(/function keptWindow\s*\(/.test(SUMMARY), false,
    "retention is a record, not a handle — reviving the lookup is a product decision");
  const REOPEN = readFileSync(join(MAIN, "session-reopen.js"), "utf8");
  assert.equal(/keptWindow\s*\(/.test(REOPEN.replace(/\/\/[^\n]*/g, "")), false,
    "no live call site for a lookup that does not exist");
});

test("the ENGINE still asks for retention on the abandonment alone", () => {
  // The rule changed at the CONSUMER, not the producer: `settle`'s argument is unchanged, and
  // `session-effects.endEffects` still sets it only for `abandoned`. If that ever widens, this
  // is where the review happens — every end retaining a pill is a different product.
  const EFFECTS = readFileSync(join(MAIN, "session-effects.js"), "utf8");
  assert.match(EFFECTS, /keepWindow: reason === 'abandoned'/,
    "one producer, one condition");
  assert.match(ENGINE, /sessionSummary\.noteEnded\(s, keepWindow === true\)/,
    "the engine hands the flag straight through");
});

test("the dead window DESTROY is gone from settle, and nothing re-reads `win` there", () => {
  // ⚠ F-234's other half. `settle` ended with `if (!keepWindow && s.win && …) s.win.destroy()`,
  // dead since every session went windowless. Removing it is what makes the flag mean one
  // thing — retain the pill — instead of two.
  const settle = ENGINE.slice(ENGINE.indexOf("function settle("), ENGINE.indexOf("function setLifecycleHandlers("));
  const code = settle.replace(/\/\/[^\n]*/g, "");
  assert.equal(/s\.win/.test(code), false, "settle no longer touches a window handle");
  assert.equal(/destroy\(\)/.test(code), false, "and destroys nothing");
});
