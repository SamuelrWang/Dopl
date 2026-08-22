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
// bound is multiplied by `MAX_CONCURRENT_SESSIONS` (`session-windowless.js`) — INVARIANTS §11
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
// 2026-08-22: is the turn this entry belongs to a PRIVATE (1:1) one? `session-private.js` owns
// the window; this lane only asks. Required above the sentinel like `appWindows`, so it is a
// free var the source-extraction test injects.
const { isPrivateTurn } = require('./session-private');
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
// ⚠ A POST IS A MESSAGE, NOT A CAPTION — see the `outbound_post` branch for the arithmetic that
// picks 1000 rather than the UI's 2000.
const POST_CAP = 1000;

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
 *   thinking        the model's own reasoning for this step (2026-08-22) — collapsed by the UI
 *   assistant       the agent's own words this turn
 *   operator        the OPERATOR spoke to this agent 1:1 (2026-08-22). Never in the channel.
 *   private         the agent's answer to a PRIVATE turn (2026-08-22). Never in the channel.
 *   tool            a tool call, WITH ITS NAME — the half F-212's entry called out by name
 *   result          how that call came back (ok / failed), summarized
 *   post            the agent SENT a message into the channel or thread
 *   status          a phase/activity move worth a line (a park, a gate, an end)
 *
 * ⚠ `tool_result` CARRIES NO `name` — the SDK gives it a `toolUseId` and nothing else — so
 * the renderer joins it to its call by that id rather than this module inventing a name.
 *
 * ⚠ THE TEXT KINDS ARE SEPARATE BECAUSE THEY ARE DIFFERENT AUDIENCES, not different styling.
 * `post` LEFT THE MACHINE and the other member has it. `operator` / `private` are the 1:1 lane
 * and nobody else can ever see them. `assistant` is the agent narrating a public turn, and
 * `thinking` is addressed to nobody. Collapsing any pair makes the view claim something was
 * shared when it was not, or the reverse — the whole reason the private turn exists.
 *
 * ── `lane` OUTRANKS `kind`, AND THAT IS THE POINT (2026-08-22) ─────────────────────────
 *
 * ⚠ AUDIENCE IS A FACT, NOT SOMETHING A RENDERER SHOULD INFER FROM A WORD. Every frame whose
 * audience matters carries an explicit `lane`, and the reader is required to prefer it:
 *   'operator'  the operator said it, 1:1. Private.
 *   'private'   the agent said it, 1:1, to the operator. Private.
 *   'channel'   it LEFT THE MACHINE — the other member has it.
 * A kind can be renamed, aliased or added; `lane` cannot drift into meaning something else, so
 * a future rename cannot leak a private reply into a public-looking face — nor, symmetrically,
 * dress a real channel post as private, which would hide that it was shared.
 * ⚠ THE NARRATION KINDS (`thinking` / `assistant` / `tool` / `result` / `status`) CARRY NO
 * LANE, deliberately: they went nowhere and have no audience to be wrong about.
 */
function entryFor(event, now) {
  const type = event && event.type;
  const p = (event && event.payload) || {};
  if (type === 'assistant') {
    const text = line(p.text, TEXT_CAP);
    return text ? { at: now, kind: 'assistant', text: text } : null;
  }
  // ⚠ 2026-08-22 — WHAT IT IS THINKING. Bounded by the same `TEXT_CAP` as every other caption:
  // a reasoning block is model-generated, unbounded by construction, and this feed crosses to a
  // renderer. The UI collapses it further; main's job is that the IPC frame stays small.
  if (type === 'thinking') {
    const text = line(p.text, TEXT_CAP);
    return text ? { at: now, kind: 'thinking', text: text } : null;
  }
  // ⚠ THE OPERATOR'S OWN 1:1 MESSAGE (2026-08-22). `rawText` is what they TYPED — the `text` on
  // this event is the FRAMED prompt (`session-seed.js › frameOperatorTurn`), which is an
  // instruction to a model and not a caption for a human. Only the 1:1 lane sets `private`, so
  // an ordinary steer still produces nothing.
  if (type === 'steer' && event && event.private === true) {
    const text = line(event.rawText, TEXT_CAP);
    return text ? { at: now, kind: 'operator', lane: 'operator', text: text } : null;
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
    // ⚠ A LONGER CAP THAN A CAPTION, AND THE ARITHMETIC IS THE REASON. This frame is a MESSAGE,
    // not a line about one: it is the local echo covering the window before the transcript has
    // loaded, and truncating a reply at 300 makes that echo useless. `POST_CAP` is 1000 rather
    // than the UI's own 2000 because the ring is `NARRATION_MAX` deep and multiplied by
    // MAX_CONCURRENT_SESSIONS — 200 posts x 2000 chars x 6 sessions is a megabyte of IPC per
    // flush. The TRANSCRIPT is the record and the UI dedupes this against it, so the echo only
    // has to be good enough to read while it arrives.
    return { at: now, kind: 'post', lane: 'channel', text: line(p.text, POST_CAP) };
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

/**
 * RE-TAG an `assistant` line as the PRIVATE REPLY when the turn it belongs to is private
 * (2026-08-22, Samuel's ruling).
 *
 * ⚠ IT IS DONE HERE RATHER THAN IN `entryFor` BECAUSE PRIVACY IS A FACT ABOUT THE SESSION, NOT
 * ABOUT THE EVENT. The SDK's assistant block looks identical either way; what makes it private
 * is the window `session-private.js` opened when the operator typed. Keeping `entryFor` pure
 * over the event is what lets the truth table drive it with no session at all.
 * ⚠ ONLY `assistant` MOVES. A tool call, its result, a post or a status line inside a private
 * turn is still exactly what it is — the post especially: a post is the one thing in a private
 * turn that did NOT stay private, and it keeps `lane: 'channel'` for that reason.
 * ⚠ IT STAMPS `lane` AS WELL AS `kind`, because the lane is what the reader is required to
 * prefer: a kind rename can never turn this line back into a public-looking one.
 */
function retagPrivate(entry, isPrivate) {
  if (!entry || !isPrivate || entry.kind !== 'assistant') return entry;
  return { ...entry, kind: 'private', lane: 'private' };
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
  const entry = retagPrivate(entryFor(event, Date.now()), isPrivateTurn(s));
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
  retagPrivate, // 2026-08-22: an `assistant` line inside a private turn is the agent's PRIVATE side
  POST_CAP,
  push,
  // the live half
  bind,
  start,
  note,
  ringFor,
};
