// session-gate.js — the INBOUND MESSAGE GATE (v2.5 Track D3, D1 + D4).
//
// Every counterparty message bound for a session that already exists on this machine
// passes through here, and NONE of them reaches the agent before the operator accepts
// it. This generalizes the v2.3 interactive `pendingInbound` hold into the universal
// gate: the reply is enqueued on the session object, the window surfaces (a recreated
// parked shell when no live session survives), an OS notification fires, and the turn
// waits. The two opt-outs are explicit: AXIS B (the MESSAGE axis) set to auto_inbound /
// auto_both, and the standing "Accept for this session" grant — either one feeds immediately,
// byte-equivalent to the pre-gate path (the reducer's feedInboundEffects).
//
// Extracted from session-engine.js because that file sits AT the 500-line §2 cap. The
// engine injects its internals via bind() (the live registry + dispatch), exactly like
// session-park.js / session-reopen.js; the leaf deps (crypto / Notification / io /
// store / sessionPark / diag) are required at the top and referenced as free vars
// INSIDE the BEGIN/END PURE block, so test/session-gate.test.mjs slices that block,
// proves it holds no electron require, and drives it with fakes.
//
// SECURITY: this module never widens a grant. It decides only WHETHER a counterparty
// turn is fed, never which tools may run — the canUseTool path (session-io /
// session-profiles) is untouched. Counterparty binding is still enforced upstream
// (session-dispatch feeds only the task's other party), an unknown decision string
// FAILS CLOSED to a decline, and nothing here is ever written to disk.

const crypto = require('crypto');
const { Notification } = require('electron');
const io = require('./session-io');
const store = require('./session-store');
const sessionPark = require('./session-park');
const { diag } = require('./diag');

// ─── BEGIN SESSION-GATE-PURE (injectable; unit-tested via source extraction) ───

let deps = null;

// The engine binds { sessions, dispatch } here at load. Read at CALL time, so bind
// order at module load does not matter.
function bind(d) {
  deps = d || null;
}

const NOTICE_NAME_CAP = 60;
const NOTICE_BODY_CAP = 120;

// One line, whitespace collapsed, capped. The same bound every counterparty-controlled
// display string gets before it is shown (never a blob, never multi-line).
function oneLine(value, cap) {
  if (value == null) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > cap ? s.slice(0, cap - 1).trimEnd() + '…' : s;
}

// PURE: the OS notification copy for a held reply. Plain voice, no em dash.
function inboundNotice(item) {
  const who = oneLine(item && item.authorName, NOTICE_NAME_CAP);
  const detail = oneLine(item && item.message, NOTICE_BODY_CAP);
  return {
    title: who ? 'Message from ' + who : 'New channel message',
    body: detail || 'Open the session window to accept or decline it.',
  };
}

// PURE: may this session feed an inbound turn with NO prompt? v2.9 reads AXIS B (the MESSAGE
// axis) — auto_inbound / auto_both — or the standing "Accept for this session" grant. The TOOL
// axis is deliberately not consulted: `bypass` grants Bash, never an incoming message.
// Default state answers no on every count, so the gate holds until the operator opts in.
// The reducer's inboundAutoAccepted answers the same question for the reducer path and MUST
// agree with this (test/session-permission-axes pins the two against each other).
function autoInbound(s) {
  const st = (s && s.state) || {};
  const m = st.messageMode;
  return m === 'auto_inbound' || m === 'auto_both' || st.inboundForTask === true;
}

// PURE-ish: did the operator already have this window in front of them? Read BEFORE the
// dispatch (FIX #8) — a hidden window is never "focused" for our purposes even if the OS
// still reports focus on it, so windowHidden is checked too. Best effort: a torn-down or
// absent window answers no.
function windowHasFocus(s) {
  try {
    if (!s || !s.win || s.win.isDestroyed()) return false;
    if (s.windowHidden === true) return false;
    return !!(s.win.isFocused && s.win.isFocused());
  } catch (_) {
    return false;
  }
}

// Fire the gate notification. SUPPRESSED when the operator ALREADY had the window in
// front of them — they are looking at the card, so an OS banner would be noise.
//
// FIX #8: `hadFocus` is captured by the caller BEFORE it dispatches. Emitting
// `inbound_pending` RESHOWS and focuses a hidden window (session-engine's RESHOW_TYPES),
// so asking isFocused() here suppressed the banner in exactly the case that needs it:
// the window popped from hidden because the operator was somewhere else entirely.
// Best effort: a missing Notification API is fine. Never logs the body.
function notifyInbound(s, item, hadFocus) {
  try {
    if (hadFocus === true) return false;
    if (!Notification || (Notification.isSupported && !Notification.isSupported())) return false;
    const notice = inboundNotice(item);
    const n = new Notification({ title: notice.title, body: notice.body });
    n.on('click', () => {
      try { if (s.win && !s.win.isDestroyed()) { s.win.show(); s.win.focus(); s.windowHidden = false; } } catch (_) { /* window gone */ }
    });
    n.show();
    return true;
  } catch (err) {
    diag('session-gate: notify failed', err && err.message);
    return false;
  }
}

// Surface a newly-held reply: the window reshow rides the engine's own emit() (a
// hidden window pops on `inbound_pending`), so this adds the OS notification only.
// `hadFocus` is the PRE-dispatch visibility (FIX #8).
function surface(s, item, hadFocus) {
  notifyInbound(s, item, hadFocus);
}

// Enqueue one inbound reply on a session that exists (live OR parked). Returns false
// only when the bounded queue is FULL, so the caller (the listener) can fall through
// to its passive notice instead of silently dropping the message.
//   auto  -> never held: dispatch straight through (the reducer feeds it, waking a
//            parked session first).
//   gated -> queued; only the HEAD is surfaced, the rest wait their turn.
function enqueue(s, a) {
  const auto = autoInbound(s);
  const item = { pendingId: crypto.randomUUID(), message: a.message, authorName: a.authorName };
  // FIX F1: record the body BEFORE anything else can consume it. A recreated shell loads
  // the channel history in parallel with this hold, and the listener already advanced its
  // cursor past this message, so the fetched window contains it. Recording it here keeps
  // it out of the fresh session's seed: accepted, it rides its own fenced continuation;
  // declined, it never reaches the agent at all.
  io.noteGatedBody(s, a.message);
  const disp = io.queueInbound(s, item, !auto);
  if (disp === 'full') return false;
  if (disp === 'dispatch') {
    // FIX #8: read the window's visibility BEFORE the dispatch, which reshows + focuses a
    // hidden window on `inbound_pending`.
    const hadFocus = windowHasFocus(s);
    deps.dispatch(s, { type: 'inbound_arrived', pendingId: item.pendingId, message: a.message, authorName: a.authorName });
    if (!auto) surface(s, item, hadFocus);
  }
  return true;
}

// The listener's live-session feed (unchanged entry point). A settled or unknown
// session is not ours to gate — the caller falls through to classify.
function feedInbound(a) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.sessionKey(a.channelId, a.taskId));
  if (!s || s.settled) return false;
  return enqueue(s, a);
}

// v2.5 D1 — the gate for a task with NO live session: recreate the parked shell (the
// v2.3 P2 machinery, window budget + fail-restrictive profile included) and hold the
// reply on it. This REPLACES the v2.2 requester auto-continuation: the same trigger
// and the same window surfacing, but the turn waits for Accept. {ok:false} means
// nothing about this task survives on this machine — the caller notifies passively.
//
// FOLLOW-UP F11: a shell recreated for a CAPPED task rehydrates the spent turn/cost budget
// (session-park FIX #9), so the Accept this gate offers can only re-hit the cap: the reducer
// ends the session on the first `result`, and the operator's click buys one dead turn. The
// card wants to know the budget is spent — either it says so and offers no Accept, or the
// reopen offers a budget top-up. Needs a product call on what "reopen a capped thread" means.
//
// FOLLOW-UP F13: the held queue lives ONLY on the in-memory session object, so a shell
// recreate (or an app restart) loses every card the operator had not answered. They are not
// re-fetched, and the listener's cursor has already moved past them, so those messages are
// silently gone from this machine. Wants either a durable pending-inbound spool or a
// re-read of the unanswered tail on recreate.
//
// FOLLOW-UP F16: while a message sits at this gate, the requester's WEB card still reads
// "Working…" — nothing tells the server that the turn is parked on a local human decision.
// Fixing it needs a new lifecycle event (a calm "waiting on the operator" state) plus web
// rendering for it, which is out of scope for a desktop-only contract.
async function feedInboundForTask(a) {
  if (!deps || !deps.sessions) return false;
  const key = store.sessionKey(a.channelId, a.taskId);
  let s = deps.sessions.get(key);
  if (!s || s.settled) {
    // FIX F4: hand the recreate the body we are about to hold, so the shell records it
    // BEFORE its (now awaited) history read — otherwise the very message that popped this
    // gate renders twice, as the card AND as a muted history bubble above it.
    const res = await sessionPark.recreateParkedShell({ channelId: a.channelId, taskId: a.taskId, holdBody: a.message });
    if (!res || !res.ok) return false;
    s = deps.sessions.get(key);
  }
  if (!s || s.settled) return false;
  return enqueue(s, a);
}

// The operator's decision on the HEAD of the queue (renderer -> session-ipc). FAIL
// CLOSED: anything that is not an explicit accept is a decline. The pendingId MUST name
// the head (FIX F9: a missing / empty id used to skip the check entirely and consume the
// head, so a card the operator never answered could be spent by a junk call).
function decideInbound(s, pendingId, decision) {
  if (!deps || !s || s.settled) return false;
  const head = s.pendingInbound && s.pendingInbound[0];
  if (!head) return false;
  const id = pendingId == null ? '' : String(pendingId);
  if (!id || id !== String(head.pendingId)) return false;
  const d = decision === 'accept' || decision === 'accept-task' ? decision : 'decline';
  io.shiftInbound(s);
  if (d === 'decline') {
    // FIX F1 belt: a declined body must be absent from the fresh session's history seed
    // as well, not only from the turn stream. (Idempotent: enqueue recorded it already.)
    io.noteGatedBody(s, head.message);
    deps.dispatch(s, { type: 'inbound_decline', pendingId: head.pendingId });
  } else {
    deps.dispatch(s, {
      type: d === 'accept-task' ? 'inbound_accept_for_task' : 'inbound_accept',
      pendingId: head.pendingId, message: head.message, authorName: head.authorName,
    });
  }
  drainQueue(s);
  return true;
}

// After a decision: an armed grant feeds everything still held (below); otherwise the
// NEXT held reply becomes the new gate card and re-surfaces.
function drainQueue(s) {
  if (drainInbound(s)) return;
  const next = s.pendingInbound[0];
  if (!next) return;
  const hadFocus = windowHasFocus(s); // FIX #8: before the reshow the dispatch can trigger
  deps.dispatch(s, { type: 'inbound_arrived', pendingId: next.pendingId, message: next.message, authorName: next.authorName });
  surface(s, next, hadFocus);
}

// Feed every reply still held, in arrival order, once an opt-in is armed — an
// "Accept for this session" grant, or AXIS B moving to auto_inbound / auto_both while a
// card was already waiting (D4: nothing is left stranded behind a control that says it flows).
// Items LEAVE the queue as they are fed, so none can be double-consumed later.
// Returns false when no opt-in is armed, so the caller can surface a card instead.
//
// FOLLOW-UP F6: one "Accept for this session" click can drain up to MAX_PENDING_INBOUND - 1
// messages the operator never read; the gate card wants to state the backlog depth first.
function drainInbound(s) {
  if (!deps || !s || s.settled || !autoInbound(s)) return false;
  let next = io.shiftInbound(s);
  while (next) {
    deps.dispatch(s, { type: 'inbound_accept', pendingId: next.pendingId, message: next.message, authorName: next.authorName });
    next = io.shiftInbound(s);
  }
  return true;
}

// ─── END SESSION-GATE-PURE ────────────────────────────────────────────────────

module.exports = {
  bind,
  inboundNotice,
  autoInbound,
  feedInbound,
  feedInboundForTask,
  decideInbound,
  drainInbound, // v2.9: called after AXIS B changes (session-ipc)
};
