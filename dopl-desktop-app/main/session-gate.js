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
// session-park.js / session-reopen.js; the leaf deps (crypto / io / store / diag) are
// required at the top and referenced as free vars
// INSIDE the BEGIN/END PURE block, so test/session-gate.test.mjs slices that block,
// proves it holds no electron require, and drives it with fakes.
//
// SECURITY: this module never widens a grant. It decides only WHETHER a counterparty
// turn is fed, never which tools may run — the canUseTool path (session-io /
// session-profiles) is untouched. Counterparty binding is still enforced upstream
// (session-dispatch feeds only the task's other party), an unknown decision string
// FAILS CLOSED to a decline, and nothing here is ever written to disk.

const crypto = require('crypto');
const io = require('./session-io');
const store = require('./session-store');
const { diag } = require('./diag');

// ─── BEGIN SESSION-GATE-PURE (injectable; unit-tested via source extraction) ───

let deps = null;

// The engine binds { sessions, dispatch } here at load. Read at CALL time, so bind
// order at module load does not matter.
function bind(d) {
  deps = d || null;
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

// ⚠ THE SURFACING HALF IS DELETED — 2026-08-20, F-228. `windowHasFocus`, `notifyInbound` and
// `surface` decided whether to raise an OS banner for a HELD reply, and suppressed it when the
// operator already had that session's window in front of them. There is no window to have in
// front of you and, more to the point, no HELD reply: a windowless session's message axis is
// held at the `auto_inbound` floor by the channel-prefs derivation, so `autoInbound`
// answers true and `enqueue` dispatches straight through. Every FIX F1 seed-exclusion rule
// below survives untouched — those are about what an agent SEES, not about a surface.
//
// ⚠ `inboundNotice` OUTLIVED THEM BY ONE WAVE AND IS NOW DELETED TOO (2026-08-20, Samuel's
// ruling; F-235 closed). It built the banner `notifyInbound` raised, and it had ZERO callers.
// The previous pass kept it as "the only statement of what that copy should say" if a
// windowless inbound notice were ever built — but its fallback body was *"Open the session
// window to accept or decline it."*, naming a surface that does not exist and an action with
// no control behind it. That is worse than a dead function: it is dead COPY, and copy is what
// a future wiring reuses without re-reading. **NO SUCH NOTICE IS COMING**: the windowless
// message axis is FLOORED at auto (`session-profiles.js › floorWindowlessMessage`, F-236) on
// both the launch lanes AND the live one, so nothing is ever held and there is nothing to
// notify anybody about. If that floor is ever lifted, the notice is a NEW design — write the
// copy for the surface that exists then, rather than reviving this.

// Enqueue one inbound reply on a session that exists (live OR parked). Returns false
// only when the bounded queue is FULL, so the caller (the listener) can fall through
// to its passive notice instead of silently dropping the message.
//   auto  -> never held: dispatch straight through (the reducer feeds it, waking a
//            parked session first).
//   gated -> queued; only the HEAD is surfaced, the rest wait their turn.
//
// THERE IS NO SELF-BYPASS AND NO PER-TURN THREAD (channels rollback, 2026-08-05). Both rode in
// on `channel-agents.deliverToAgent` / `channel-deliver`, which routed the operator's own words
// to their own team agent and stamped the thread the turn arrived in. Those modules are deleted:
// every caller of feedInbound / feedInboundForTask (session-dispatch `:111`, `:226`, `:335`)
// structurally excludes own-authored messages before it calls, so `a.selfAuthored` had no writer
// left, and `a.threadId` was `''` end to end. AXIS B (autoInbound) is the only opt-out now.
function enqueue(s, a) {
  const auto = autoInbound(s);
  // The latest inbound turn's seq — the windowless outbound bridge keys its consent
  // row on it so the send box lands on the right thread (a non-finite seq keeps the last).
  if (Number.isFinite(Number(a.seq))) s.lastInboundSeq = Number(a.seq);
  // `addressing` rides with the message from `session-dispatch` (the @agent-id verdict for THIS
  // reader) all the way to `session-seed.frameContinuation`. It is FRAMING, never a gate: a
  // message addressed to a sibling is still delivered here, in full, and the turn says so.
  const item = { pendingId: crypto.randomUUID(), message: a.message, authorName: a.authorName, addressing: a.addressing || null };
  const disp = io.queueInbound(s, item, !auto);
  // AUDIT D2: a REJECTED message is not a gated one. noteGatedBody used to run BEFORE this
  // early return, so a reply that overflowed the queue (MAX_PENDING_INBOUND) fell through to
  // the caller's passive notice AND had its body recorded in s.gatedBodies — which
  // session-history and session-seed both filter out. The message existed on the server and
  // was invisible in the window and to the agent forever. Nothing was gated here, so nothing
  // is recorded; the passive notice is the only trace, exactly as intended.
  if (disp === 'full') return false;
  // ── ⚠ THE WAKE ACKNOWLEDGEMENT (2026-09-01, T50) ──────────────────────────────────────
  // An `@agent-<id>` in a post body is a wake the SERVER cannot confirm: the token is parsed on
  // this machine, by `session-dispatch.js › feedLiveSession`, and nothing crosses back. So an
  // orchestrator that redirected an agent had no way to tell "it landed and the agent is on it"
  // from "it landed on nobody" — and the two need opposite next actions.
  // ⚠ STAMPED HERE, PAST THE OVERFLOW RETURN, BECAUSE THIS IS DELIVERY. A wake recorded above
  // that line would claim a turn for a message the queue rejected, which is precisely the class
  // of false confirmation this stamp exists to remove.
  // ⚠ IT READS THE VERDICT, NEVER THE BODY. `a.wake` is the tier decision already made for THIS
  // message and THIS agent; re-deriving it here would be a second spelling of the wake rule.
  // ⚠ NO CHANNEL POST GOES WITH IT, by ruling: the acknowledgement is a FIELD an orchestrator
  // reads on its next `read_sessions`, not a row in a transcript both members pay for.
  // ⚠ `typeof` FIRST, WHERE `lastInboundSeq` ABOVE COERCES, AND THE ASYMMETRY IS DELIBERATE.
  // `Number(null)` is 0 and `Number([])` is 0, so the coercion-only guard beside it stamps a
  // seq of ZERO for an absent one — harmless there (the value is a de-dupe hint for a consent
  // row) and a LIE here, because this field is rendered as `woke on #0`. The seq really is a
  // number on the wire (`server/dto.ts › seq: Number(row.seq)`), so nothing legitimate is lost;
  // an unexpected shape costs the acknowledgement rather than inventing one, which is the
  // fail-safe direction for a field an orchestrator acts on.
  if (a.wake === true && typeof a.seq === 'number' && Number.isFinite(a.seq)) {
    s.lastWakeSeq = a.seq;
    s.lastWakeAt = Date.now();
  }
  // FIX F1: record the body BEFORE anything else can consume it. A recreated shell loads
  // the channel history in parallel with this hold, and the listener already advanced its
  // cursor past this message, so the fetched window contains it. Recording it here keeps
  // it out of the fresh session's seed: accepted, it rides its own fenced continuation;
  // declined, it never reaches the agent at all. Still ahead of every consumer: queueInbound
  // above only appends to the in-memory FIFO, and the dispatch that feeds it is below.
  io.noteGatedBody(s, a.message);
  if (disp === 'dispatch') {
    deps.dispatch(s, {
      type: 'inbound_arrived', pendingId: item.pendingId, message: a.message, authorName: a.authorName,
      addressing: item.addressing,
    });
  }
  return true;
}

// The listener's live-session feed. A settled or unknown session is not ours to gate — the
// caller falls through to classify.
// ⚠ `a.agentId` IS REQUIRED IN PRACTICE SINCE 2026-08-21: the slot is (channel, thread, AGENT),
// so a call that names no agent resolves nothing on a real thread rather than picking one at
// random. `session-dispatch.feedLiveSession` is the one production caller and it iterates the
// thread's live sessions, naming each — the fan-out. Fail-closed by construction.
// ⚠ AND THE SPAWN-IDLE WAKE BELT SINCE 2026-08-22 (Samuel's ruling). An UNWOKEN spawn-idle
// session — registered by New Agent, holding a slot and an @-mention address, with no `claude`
// child at all — is fed NOTHING until something names its agent id. `session-dispatch.js ›
// mayFeed` is the primary gate and carries the whole argument; this is the belt, here rather than
// only there because this function is the ENTRY POINT (`session-engine.feedInbound`) and a second
// caller must not be able to wake an agent by saying nothing to it. Refusing is the same shape as
// a full queue: `false`, and the caller falls through.
// ⚠ IT READS THE VERDICT, NOT THE BODY. `a.wake` is the WAKE decision already made for THIS
// message and THIS agent by `session-dispatch.js › feedLiveSession`; re-deriving it here would be
// a second spelling of the wake rule, which is how two readers come to disagree about one message.
//
// ⚠ THE VERDICT REPLACED `a.addressing` ON 2026-08-28 (Samuel's TIERED WAKE ruling), and that is a
// TIGHTENING as well as a rewiring. This line used to read the @-mention verdict directly, which
// was correct while an @-mention was the ONLY thing that could wake a dormant agent. There are
// three wake tiers now — @-mention, a solo-agent room, and a triage claim — and two of them carry
// NO addressing at all, so an `addressing`-shaped belt would have refused exactly the wakes the
// ruling adds. Reading the boolean instead means the belt tracks the rule automatically, and it
// closes the one door that was open before: an @-mention from an AGENT no longer passes here,
// because the loop fence (`session-wake-tiers.js › wakeEligible`) already answered `wake: false`.
//
// ⚠ IT STILL FENCES ONLY `awaitingDirective`, NOT EVERY DORMANT SESSION. The PARKED half of the
// tier gate lives in `session-dispatch.js › mayFeed` alone, deliberately: this function is the
// engine's ENTRY POINT and every other lane that resumes a parked session (the operator's 1:1
// `steer`, an inbound release, the post-sign-in resume) reaches a parked session through paths
// that never set `wake`. Narrowing the entry point would break those; the class that has no other
// guard is the shell that never ran, and that is the class this belt is for.
function feedInbound(a) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.slotKey(a));
  if (!s || s.settled) return false;
  if (s.awaitingDirective === true && a.wake !== true) return false;
  return enqueue(s, a);
}

// ⚠ FOUR MORE WENT IN THE SAME SWEEP — 2026-08-20, F-228.
//
//   feedInboundForTask  recreated a parked SHELL for a thread with no live session and held the
//                       reply on it. Its two callers were `session-ipc` and `session-dispatch`
//                       routes 3/5; the shell-recreate lane it depended on is deleted.
//   decideInbound       the operator's Accept/Decline on the HEAD of the queue, dispatched from
//                       the session window's gate card via `session-ipc`. There is no card.
//   drainQueue          re-surfaced the NEXT held reply after a decision — an OS banner plus a
//                       window reshow.
//   drainInbound        fed everything still held once an opt-in armed. Called after an AXIS B
//                       change from `session-ipc`, and nothing can be held any more.
//
// ⚠ WHAT MAKES THIS SAFE RATHER THAN A LOST FEATURE: a windowless session's message axis is
// FLOORED at `auto_inbound` (INVARIANTS §11), so `autoInbound(s)` is true, `enqueue` takes the
// `dispatch` branch, and the queue never holds. The hold path and its accept surface were one
// mechanism, and they are removed together rather than leaving a hold nothing can answer.

// ─── END SESSION-GATE-PURE ────────────────────────────────────────────────────

module.exports = {
  bind,
  autoInbound,
  feedInbound,
};
