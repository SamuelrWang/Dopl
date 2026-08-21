// SESSION NARRATION — the WORK LANE (2026-08-20, F-212's second lane).
//
// WHAT IT IS. A bounded, per-session ring of what an agent has been DOING — its own text,
// the tools it called WITH THEIR NAMES, the results it got back, the messages it posted —
// pushed to the app windows that asked for it. It is the backing the agent view's second
// lane never had: "work narration (`scanning 14 components…`)" was drawn in the mock,
// stated as absent in the panel, and filed as F-212 rather than faked.
//
// ⚠ WHY A SECOND BRIDGE CHANNEL AND NOT A WIDER `sessions.summaries`. F-212 named the two
// options and asked for the ring's bound to be decided first. The summaries feed is
// DIGEST-GATED and coalesced at `PUSH_COALESCE_MS` — it fires when the projection MOVES,
// which is a handful of times per session, and `session-state-push.js` SUBSCRIBES to that
// same gate to decide when to write the server. Riding narration on it would either
// destroy the gate (a server write per tool call) or drop most of the narration (a digest
// over a ring changes on every append). Different cadence, different consumer, different
// channel.
//
// ⚠ THE RING IS BOUNDED AT THE SOURCE, AND THE BOUND IS MULTIPLICATIVE. Every per-session
// bound is multiplied by `MAX_CONCURRENT_SESSIONS` (4, `session-pool.js`) — INVARIANTS §11
// says so and this is one of them. 200 entries x ~200 bytes x 4 sessions is well under a
// megabyte, and the ring dies with the session object (no persistence, no TTL, no sweep).
//
// ⚠ NOTHING PRIVILEGED CROSSES. Entries carry ALREADY-SUMMARIZED display text: the tool
// name through the gate's own normalizer, and `inputSummary` — which `session-io.js ›
// summarizeInput` has already capped at 140 chars. **`inputFull` NEVER enters the ring.**
// It exists for the session window's expandable card, it can carry an entire file's
// contents, and this feed crosses to a renderer that logs nothing and stores nothing.
//
// ⚠ IT IS A VIEW OF A RUN, NOT A RECORD OF ONE. A window opened after the fact sees the
// last 200 entries and no more; the channel transcript is what persists. That is the same
// retention argument `session-summary.js` makes for an ended pill.

const appWindows = require('./app-windows');
const { diag } = require('./diag');

// ─── BEGIN SESSION-NARRATION-PURE (injectable; unit-tested via source extraction) ─────
// `appWindows` and `diag` are free vars from here down.

const NARRATION_EVENT = 'dopl:session-narration';

// The per-session ring. See the header for the arithmetic; 200 is roughly an hour of a
// busy agent and comfortably more than a human scrolls back through.
const NARRATION_MAX = 200;

// One burst of engine dispatches must cost ONE render, exactly as the summaries feed
// decided. Deliberately the SAME 200ms: two feeds landing on one surface at different
// cadences make the panel judder for no benefit.
const PUSH_COALESCE_MS = 200;

// Text bounds. A narration line is a caption, and every one of these strings is
// counterparty- or model-influenced on its way to a renderer.
const TEXT_CAP = 300;
const TOOL_CAP = 40;

/** One line, whitespace collapsed, bounded, or ''. The same discipline as
 *  `session-summary.js › displayText`. */
function line(value, cap) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, cap).trim();
}

/**
 * ONE REDUCER EVENT -> ONE NARRATION ENTRY, or `null` for an event this lane has nothing
 * to say about.
 *
 * ⚠ THE KIND VOCABULARY IS CLOSED and the renderer maps it; an unknown kind must never
 * reach the wire, which is what the explicit switch buys over a pass-through.
 *
 *   assistant       the agent's own words this turn
 *   tool            a tool call, WITH ITS NAME — the half F-212's entry called out by name
 *   result          how that call came back (ok / failed), summarized
 *   post            the agent sent a message to the peer
 *   status          a phase/activity move worth a line (a park, a gate, an end)
 *
 * ⚠ `tool_result` CARRIES NO `name` — the SDK gives it a `toolUseId` and nothing else — so
 * the renderer joins it to its call by that id rather than this module inventing a name.
 */
function entryFor(event, now) {
  const type = event && event.type;
  const p = (event && event.payload) || {};
  if (type === 'assistant') {
    const text = line(p.text, TEXT_CAP);
    return text ? { at: now, kind: 'assistant', text: text } : null;
  }
  if (type === 'tool_use') {
    return {
      at: now,
      kind: 'tool',
      toolUseId: line(p.toolUseId, TOOL_CAP),
      // ⚠ RAW name, bounded — the RENDERER shortens it, through the same
      // `session-detail.js › toolLabel` the pill's detail uses. Two shorteners would
      // disagree about the same call in two places on one screen.
      tool: line(p.name, TOOL_CAP),
      // ⚠ `inputSummary` ONLY. `inputFull` is unbounded by construction (see the header).
      text: line(p.inputSummary, TEXT_CAP),
    };
  }
  if (type === 'tool_result') {
    return {
      at: now,
      kind: 'result',
      toolUseId: line(p.toolUseId, TOOL_CAP),
      ok: p.ok !== false,
      text: line(p.resultSummary, TEXT_CAP),
    };
  }
  if (type === 'outbound_post') {
    return { at: now, kind: 'post', text: line(p.text, TEXT_CAP) };
  }
  // A status line is worth a narration entry only when it says something a WATCHER would
  // want: the pill already carries the live state, so this is for the transitions that
  // explain a silence (parked, ended, blocked on a gate).
  if (type === 'idle_timeout') return { at: now, kind: 'status', text: 'Paused — idle' };
  if (type === 'interrupt') return { at: now, kind: 'status', text: 'Paused by you' };
  if (type === 'end') return { at: now, kind: 'status', text: 'Ended by you' };
  if (type === 'inactive') return { at: now, kind: 'status', text: 'Ended — inactive' };
  if (type === 'permission_request') {
    return { at: now, kind: 'status', text: 'Waiting for permission' };
  }
  return null;
}

/** Append to a session's ring, dropping the oldest past the bound. Returns the ring. */
function push(s, entry) {
  if (!s.narration) s.narration = [];
  s.narration.push(entry);
  if (s.narration.length > NARRATION_MAX) {
    s.narration = s.narration.slice(s.narration.length - NARRATION_MAX);
  }
  return s.narration;
}

// ─── END SESSION-NARRATION-PURE ──────────────────────────────────────────────────────

// ── The live half: the coalesced fan-out ─────────────────────────────────────────────

// sessionKey -> true, for keys that gained entries since the last flush. Only those are
// pushed, so a busy session cannot cost a frame for every idle one.
const dirty = new Map();
let pushTimer = null;
let getWindowsFn = null;

/** Arm the push. ⚠ `getWindows()` is called at SEND time, never captured — modelled on
 *  `session-summary.js › start`, and for the same reason: a window is rebuilt on reopen
 *  and an agent window can appear at any moment. Idempotent. */
function start(opts) {
  getWindowsFn = opts && typeof opts.getWindows === 'function'
    ? opts.getWindows
    : () => appWindows.liveWindows();
}

/**
 * A session dispatched an event. Record what it says, if anything.
 * ⚠ CALLED FROM THE ENGINE'S ONE DISPATCH FUNNEL, on EVERY SDK event, so the fast path is
 * `entryFor` returning null and nothing else happening.
 */
function note(s, event) {
  if (!s || !s.key) return;
  const entry = entryFor(event, Date.now());
  if (!entry) return;
  push(s, entry);
  dirty.set(String(s.key), true);
  schedule();
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

let getSessions = null;

/** The engine binds its registry here at load, exactly as session-summary does. */
function bind(d) {
  getSessions = (d && d.sessions) || null;
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
  // the pure core (re-exported for the shell + the tests)
  NARRATION_EVENT,
  NARRATION_MAX,
  PUSH_COALESCE_MS,
  entryFor,
  push,
  // the live half
  bind,
  start,
  note,
  ringFor,
};
