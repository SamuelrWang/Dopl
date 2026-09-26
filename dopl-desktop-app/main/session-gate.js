// session-gate.js — the INBOUND FEED: every counterparty message bound for a session that already
// exists on this machine enters here (`session-engine.feedInbound`).
//
// ⚠ IT HOLDS NOTHING. Inbound consent is retired (2026-08-22, Samuel: "remove all the stuff about
// declining and approving of threads"), so a message is dispatched to the reducer the moment it
// arrives. The hold queue, the Accept / Decline arms, the standing "Accept for this session" grant
// and the `awaiting_inbound` phase are deleted (2026-09-25, Samuel's ruling 5): nothing could answer
// a hold any more, and the one lane still reaching it — a session held on its sign-in — kept the
// message there forever, invisible to the agent.
//
// Extracted from session-engine.js (the 500-line §2 cap). The engine injects its internals via
// bind() (the live registry + dispatch); the leaf deps are required at the top and referenced as
// free vars INSIDE the BEGIN/END PURE block, so test/session-gate.test.mjs slices that block, proves
// it holds no electron require, and drives it with fakes.
//
// SECURITY: this module never widens a grant. It decides only WHETHER a counterparty turn is fed,
// never which tools may run — the canUseTool path (session-io / session-profiles) is untouched. WHO
// a message is for is decided upstream and, since 2026-09-02, on the SERVER (`session-dispatch.js`
// executes the stored verdict and feeds only the sessions it names). Nothing here is written to disk.

const io = require('./session-io');
const store = require('./session-store');

// ─── BEGIN SESSION-GATE-PURE (injectable; unit-tested via source extraction) ───

let deps = null;

// The engine binds { sessions, dispatch } here at load. Read at CALL time, so bind
// order at module load does not matter.
function bind(d) {
  deps = d || null;
}

// Deliver one inbound reply to a session that exists (live OR parked; the reducer wakes a parked one).
function enqueue(s, a) {
  // The latest inbound turn's seq — the windowless outbound bridge keys its consent
  // row on it so the send box lands on the right thread (a non-finite seq keeps the last).
  if (Number.isFinite(Number(a.seq))) s.lastInboundSeq = Number(a.seq);
  // ── ⚠ THE WAKE ACKNOWLEDGEMENT (2026-09-01, T50) ──────────────────────────────────────
  // An `@agent-<id>` in a post body is a wake the SERVER cannot confirm: the token is parsed on
  // this machine, by `session-dispatch.js › feedLiveSession`, and nothing crosses back. So an
  // orchestrator that redirected an agent had no way to tell "it landed and the agent is on it"
  // from "it landed on nobody" — and the two need opposite next actions.
  // ⚠ IT READS THE VERDICT, NEVER THE BODY. `a.wake` is the tier decision already made for THIS
  // message and THIS agent; re-deriving it here would be a second spelling of the wake rule.
  // ⚠ NO CHANNEL POST GOES WITH IT, by ruling: the acknowledgement is a FIELD an orchestrator
  // reads on its next `read_sessions`, not a row in a transcript both members pay for.
  // ⚠ `typeof` FIRST, WHERE `lastInboundSeq` ABOVE COERCES, AND THE ASYMMETRY IS DELIBERATE.
  // `Number(null)` is 0, so the coercion-only guard beside it stamps a seq of ZERO for an absent
  // one — harmless there (a de-dupe hint for a consent row) and a LIE here, because this field is
  // rendered as `woke on #0`. An unexpected shape costs the acknowledgement rather than inventing one.
  if (a.wake === true && typeof a.seq === 'number' && Number.isFinite(a.seq)) {
    s.lastWakeSeq = a.seq;
    s.lastWakeAt = Date.now();
  }
  // FIX F1: record the body BEFORE the dispatch can consume it. A fresh session loads the channel
  // history in parallel, and the listener already advanced its cursor past this message, so the
  // fetched window contains it; recording it keeps it out of the seed, since it rides its own
  // fenced continuation.
  io.noteGatedBody(s, a.message);
  // `addressing` (the @agent-id verdict for THIS reader) and `authorNote` (one line of OUR narration
  // about the author, null when the start card already named them) are FRAMING, never a gate.
  deps.dispatch(s, {
    type: 'inbound_arrived', message: a.message, authorName: a.authorName,
    authorNote: a.authorNote || null, addressing: a.addressing || null, replyTo: a.replyTo || '', fromOperator: a.fromOperator === true,
  });
  return true;
}

// The listener's live-session feed. A settled or unknown session is not ours to feed — the caller
// files a `refused` receipt. `a.agentId` is required in practice: the slot is (channel, thread, AGENT),
// and `session-dispatch.feedLiveSession`, the one production caller, names each live session.
//
// ⚠ THE SPAWN-IDLE WAKE BELT (2026-08-22, Samuel's ruling). An UNWOKEN spawn-idle session is fed
// NOTHING until something names its agent id. `session-dispatch.js › mayFeed` is the primary gate;
// this is the belt, because this function is the ENTRY POINT and a second caller must not be able
// to wake an agent by saying nothing to it. It reads the VERDICT (`a.wake`), never the body, so it
// tracks the wake rule automatically (a server-repaired address carries no `@` at all).
// ⚠ IT FENCES ONLY `awaitingDirective`: the PARKED half of the tier gate lives in `mayFeed` alone,
// because every other lane that resumes a parked session never sets `wake`.
//
// ⚠ A SESSION HELD ON ITS SIGN-IN IS REFUSED (2026-09-25). It has no credential to spawn with, so
// nothing could deliver the message; refusing leaves it in the channel history the agent reads once
// the sign-in resumes it, and tells the sender it did not land.
function feedInbound(a) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.slotKey(a));
  if (!s || s.settled) return false;
  if (s.awaitingDirective === true && a.wake !== true) return false;
  if (s.state && s.state.authHeld === true) return false;
  return enqueue(s, a);
}

// ─── END SESSION-GATE-PURE ────────────────────────────────────────────────────

module.exports = {
  bind,
  feedInbound,
};
