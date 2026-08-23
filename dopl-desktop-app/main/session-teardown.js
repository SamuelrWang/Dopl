// session-teardown.js — THE END OF A SESSION, AND WHAT SURVIVES IT.
//
// ⚠ SPLIT OUT OF `main/session-engine.js` ON 2026-08-22, under the hard 500-line §2 cap. The
// engine sat EXACTLY on it, which is the state ENGINEERING.md §2 warns about: a file at the cap
// does not merely stop growing, it stops being CORRECTABLE, and the spawn-idle wake rule needed
// three fields and their arguments in that file.
//
// THE SEAM IS REASON-TO-CHANGE, like every other split off that file. `session-engine.js` owns
// the RUNTIME — the SDK query, the effect table, the reducer dispatch. This owns the TERMINAL:
// what is torn down, in what order, what is frozen before the registry entry disappears, and how
// a dead agent is still read afterwards. Those two change on different clocks: teardown changes
// when the retention story changes, the runtime when the loop does.
//
// ⚠ `settle` IS THE ONE TEARDOWN EVERY TERMINAL REACHES — operator End, both caps, the crash
// path, the abandonment bound, the quit sweep. Nothing may be added beside it: a second teardown
// is a second set of the C3 bugs (an orphaned `claude` child still holding this session's
// pre-approved `dopl_channel` access, with nothing left pointing at it to stop it).
//
// ⚠ NO ELECTRON, NO SDK HANDLE. Everything the teardown cannot compute is injected via `bind()`
// (the registry, the durable-record projection, the fail-closed permission sweep, the tray
// refresh); the leaf deps are required at the top. Same idiom as `session-park.js`.

const store = require('./session-store');
const agentHistory = require('./agent-history'); // what an ended agent leaves, for 7 days
const sessionMetrics = require('./session-metrics'); // ...and what it cost, frozen with it
const sessionNarration = require('./session-narration');
const sessionSummary = require('./session-summary');
const { diag } = require('./diag');

let deps = null;

/**
 * The engine binds its internals here at load: the live registry, `baseRecord` (the durable-record
 * projection), `denyPendingPermissions` (the fail-closed sweep of awaited canUseTool promises),
 * `refreshTray`, and `sessionOn` (the address -> live session read).
 * ⚠ `bind` REBUILDS `deps` FROM A LITERAL, so a handle the engine passes and this list omits is
 * DROPPED SILENTLY — the trap `session-reopen.js › bind` records, where the drop wore the face of
 * a guard firing correctly. Add the field HERE whenever the engine's call grows one.
 */
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    baseRecord: (d && d.baseRecord) || null,
    denyPendingPermissions: (d && d.denyPendingPermissions) || function () {},
    refreshTray: (d && d.refreshTray) || function () {},
    sessionOn: (d && d.sessionOn) || null,
  };
}

// Terminal: drop the live handles, mark the record ended, free the slot. A DONE task drops the
// resume entry; every other end KEEPS the sdkSessionId (FIX #7).
// `keepWindow` — the abandonment case alone; the argument is at session-effects.endEffects.
// ⚠ IT NO LONGER NAMES A WINDOW, AND THE DESTROY IS GONE (2026-08-20, F-234). This function
// ended with `if (!keepWindow && s.win && !s.win.isDestroyed()) s.win.destroy()`, which has
// been dead since every session went windowless — `s.win` is null on all of them. What the
// flag means now is "retain the ENDED PILL", which `session-summary.noteEnded` honours
// unconditionally; the name is the engine's and is left alone rather than renamed for cosmetics.
function settle(s, outcome, keepWindow) {
  if (s.settled) return;
  s.settled = true;
  // C3 (CRITICAL) — a settled session must leave NOTHING live. The CRASH path settles WITHOUT
  // parking, so until now every awaited canUseTool promise hung forever (the SDK child blocks on
  // it) and the push iterator kept the prompt stream open: the `claude` process outlived the
  // window and could go on posting into the channel with nothing left to show it. Deny each
  // awaited request fail-closed, close the iterator, and abort here, so teardown holds whichever
  // branch reached it (the reducer aborts too).
  deps.denyPendingPermissions(s, 'Session ended');
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  store.saveRecord(deps.baseRecord(s)); // FIX #9: full record persists cap counters for a rehydrate
  if (outcome === 'completed' || outcome === 'failed') store.clearSdkSessionId(s.key);
  // ⚠ FREEZE THE HISTORY BEFORE THE REGISTRY ENTRY GOES (2026-08-22, Samuel's ruling). The
  // narration ring lives on `s` and nowhere else, so this is the last moment it exists. Best
  // effort by construction: `settle` is the ONE teardown every terminal reaches, and a disk
  // failure here must not leave a `claude` child un-aborted.
  try {
    agentHistory.record({
      key: s.key, agentId: s.agentId, sessionId: s.sessionId,
      channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId,
      channelName: (s.context && s.context.channelName) || null,
      threadTitle: (s.context && s.context.taskTitle) || null,
      endedAt: Date.now(),
      // The final measurement, frozen here for the same reason the identity is: the registry
      // entry is about to go and `metrics(s)` is the only reader of it.
      ...sessionMetrics.metrics(s),
      entries: sessionNarration.ringFor(s),
    });
  } catch (err) { diag('session-teardown: could not freeze agent history —', err && err.message); }
  deps.sessions.delete(s.key);
  sessionSummary.noteEnded(s, keepWindow === true); // retention is the history file's, for 7 days
  deps.refreshTray();
}

// THE WORK LANE FOR ONE ADDRESS — live if it is live, FROZEN if the agent has ended.
// ⚠ THE FALLBACK IS THE WHOLE POINT (2026-08-22). This was `ringFor(sessionOn(a))`, and
// `sessionOn` resolves against the LIVE registry `settle` has already deleted from — so an ENDED
// agent's window answered `[]`, while `agent-history.js › historyFor` (the 7-day ring `settle`
// freezes for exactly this read) had ZERO callers. Same key `settle` wrote, `store.slotKey`, so
// an address naming no agent gets the live answer alone: `<channel>:<thread>:` matches no record.
// ⚠ IT LIVES BESIDE `settle` RATHER THAN WITH THE OTHER READS, and that is the point of the seam:
// it is the ONLY read whose correctness depends on what `settle` wrote a moment earlier, so the
// write and the read are one thing to change.
function narrationFor(a) {
  const live = deps.sessionOn(a);
  if (live) return sessionNarration.ringFor(live);
  const rec = agentHistory.historyFor(store.slotKey(a));
  return rec && Array.isArray(rec.entries) ? rec.entries.slice() : [];
}

module.exports = { bind, settle, narrationFor };
