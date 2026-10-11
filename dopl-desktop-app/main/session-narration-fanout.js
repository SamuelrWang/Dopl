// THE NARRATION FEED'S LIVE HALF — the coalesced fan-out. §2 SPLIT out of
// `main/session-narration.js` (2026-10-11, the hard 500-line §1 cap; its third split, after
// `narration-text.js` and `narration-ring.js`).
//
// ⚠ WHAT IS HERE IS "WHEN AND WHERE A FRAME GOES", AND THAT IS THE SEAM. The dirty set, the one
// coalescing timer, the window-registry fan-out and the engine's registry binding all turn on the
// SHAPE OF THE HOST — how many windows are live, how often a renderer may be written to, which
// registry answers for a key. Nothing here knows what a frame SAYS: the event -> entry mapping
// (`entryFor`) and the privacy re-tag stay in `session-narration.js`, and the per-entry shapers
// are `session-narration-shape.js`. Two different reasons to change, which is the same argument
// `narration-text.js`'s header makes for its own split.
//
// ⚠ **THE MUTABLE STATE LIVES HERE AND THERE IS EXACTLY ONE OF EACH.** `dirty`, `pushTimer`,
// `getWindowsFn` and `getSessions` are declared in THIS module and nowhere else, and that is the
// correctness argument for the split rather than a tidiness one. A SECOND `dirty` Map bounds
// nothing — the appending half would mark keys the flushing half never reads, so a busy session
// would go out as an empty push and an idle one would never be cleared. A SECOND `pushTimer`
// DOUBLE-FIRES the fan-out, at up to `1000 / PUSH_COALESCE_MS` = 5 Hz per window, which is the
// rate `narration-ring.js › RING_CHAR_BUDGET` exists to hold down (the 17 GB dev incident).
// `listener-io.js` -> `listener-people.js` pinned this same class of mistake for the member
// caches: "a copy of either Map here would bound nothing". So the state never leaves this file —
// the appending half calls {@link touch}, which marks AND arms inside the module that owns both.
//
// ⚠ **IT NEVER REQUIRES `session-narration.js` BACK.** That module replaces `module.exports`
// wholesale, so a partner capturing it at load time gets `{}` and every call through it is a
// TypeError on the first append. The dependency points ONE WAY (session-narration -> here) and
// this file requires only the two host seams it fans out over, so there is no cycle to break
// lazily in the first place.
//
// Every name below is re-exported from `session-narration.js` unchanged, so no caller and no
// test moved.

const appWindows = require('./app-windows');
const { diag } = require('./diag');

const NARRATION_EVENT = 'dopl:session-narration';

// One burst of engine dispatches must cost ONE render, exactly as the summaries feed
// decided. Deliberately the SAME 200ms: two feeds landing on one surface at different
// cadences make the panel judder for no benefit.
const PUSH_COALESCE_MS = 200;

// sessionKey -> true, for keys that gained entries since the last flush. Only those are
// pushed, so a busy session cannot cost a frame for every idle one.
const dirty = new Map();
let pushTimer = null;
let getWindowsFn = null;
let getSessions = null;

/** Arm the push. ⚠ `getWindows()` is called at SEND time, never captured — modelled on
 *  `session-summary.js › start`, and for the same reason: a window is rebuilt on reopen
 *  and an agent window can appear at any moment. Idempotent. */
function start(opts) {
  getWindowsFn = opts && typeof opts.getWindows === 'function'
    ? opts.getWindows
    : () => appWindows.liveWindows();
}

/** The engine binds its registry here at load, exactly as session-summary does. */
function bind(d) {
  getSessions = (d && d.sessions) || null;
}

/** The ring for one session, newest last. `[]` for a session with nothing said yet — a
 *  DIFFERENT answer from the renderer's "could not ask", which is its own to make. */
function ringFor(s) {
  return (s && Array.isArray(s.narration)) ? s.narration.slice() : [];
}

function schedule() {
  if (pushTimer) return;
  pushTimer = setTimeout(flush, PUSH_COALESCE_MS);
  if (typeof pushTimer.unref === 'function') pushTimer.unref();
}

/**
 * A SESSION GAINED AN ENTRY: mark it dirty and arm the coalesced push (2026-10-11, with the split).
 *
 * ⚠ IT EXISTS SO THE APPENDING HALF HOLDS NONE OF THE STATE. `note` / `noteEnded` /
 * `noteLaunchMessage` ran `dirty.set(String(s.key), true); schedule();` inline while they shared a
 * file with the Map and the timer; across the seam they call this instead, which is the same two
 * statements over the SAME Map and the SAME timer. Exporting `dirty` itself would have worked and
 * would also have invited `new Map(fanout.dirty)` — the copy that bounds nothing — so the Map stays
 * module-private and this is the whole door.
 */
function touch(key) {
  dirty.set(String(key), true);
  schedule();
}

/**
 * ⚠ FANS OUT OVER THE REGISTRY, like every other main->renderer push since Phase 10
 * (INVARIANTS §11: "EVERY MAIN→RENDERER PUSH FANS OUT OVER THE REGISTRY, or the pop-out is
 * stale with no error anywhere"). One dead window must not swallow the rest.
 * ⚠ The payload is keyed by `sessionKey`, so a window filters to the agent it is showing
 * and every other window ignores the frame. Main does not track who is watching what —
 * that would be a subscription protocol whose only failure mode is going out of step.
 */
function sendToWindows(payload) {
  let wins = null;
  try { wins = getWindowsFn ? getWindowsFn() : appWindows.liveWindows(); }
  catch (_err) { return false; }
  if (!Array.isArray(wins) || wins.length === 0) return false;
  let sent = 0;
  for (const win of wins) {
    if (!appWindows.isLiveWindow(win)) continue;
    try { win.webContents.send(NARRATION_EVENT, payload); sent += 1; }
    catch (err) { diag('session-narration send error', err && err.message); }
  }
  return sent > 0;
}

function flush() {
  pushTimer = null;
  if (!getSessions || dirty.size === 0) { dirty.clear(); return; }
  for (const key of [...dirty.keys()]) {
    const s = getSessions.get(key);
    // A session that settled between the append and the flush has nothing to send; its
    // ring went with it.
    if (s) sendToWindows({ sessionKey: key, entries: ringFor(s) });
  }
  dirty.clear();
}

module.exports = {
  NARRATION_EVENT,
  PUSH_COALESCE_MS,
  bind,
  start,
  touch,
  ringFor,
  schedule,
  sendToWindows,
  flush,
};
