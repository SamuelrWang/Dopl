// ENGINE STATE -> WHAT A HUMAN IS SHOWN ABOUT IT. The pill, and the liveness beside it.
//
// ⚠ SPLIT OUT OF `main/session-summary.js` ON 2026-08-22, at the hard 500-line §2 cap. That file
// stood at exactly 500 with no headroom, and Samuel's Waiting/Idle ruling needed a new derivation
// plus the argument for it — a file at the cap does not just stop growing, it stops being
// CORRECTABLE, which is the state F-226 was taken out of.
//
// THE SEAM IS REASON-TO-CHANGE, and it is a real one. THIS file answers "given the reducer's
// state, what word does a person see" — one input, no session object, no registry, no I/O. It
// changes when the VOCABULARY changes. `session-summary.js` owns the PROJECTION: which sessions
// exist, what identity and measurements ride with each, when the digest moved and who is told.
// It changes when the shape of a summary changes. They shared a file because the projection is
// the mapping's only caller, which is not the same thing as being one concern.
//
// ⚠ ONE DERIVATION, AND NOW ONE IMPORT PATH. The split shipped with a compatibility re-export in
// `session-summary.js` ("every existing reader is unchanged"), and on 2026-08-22 a census found
// that re-export had NO production reader in either tree — only this suite's harnesses, which
// already require THIS module. It is deleted: **require this file.** Two names for one function
// is how a second mapping gets added without anyone deciding to, and two readers deriving state
// their own way and disagreeing in production is the defect the pills exist to delete (F-142).
//
// PURE, and it must stay so: no require below the sentinel, no session object, no clock.

// ─── BEGIN SESSION-PILL-PURE (pure; unit-tested via source extraction) ────────────────

// ── THE STATE MAPPING ────────────────────────────────────────────────────────────────
// Engine vocabulary is two fields (session-state.js / session-reducer.js): PHASE (launching /
// running / awaiting_permission / awaiting_inbound / interrupted / parked / ended) and ACTIVITY
// (working / idle / awaiting_peer / awaiting_permission / awaiting_inbound / parked). A pill
// has THREE states:
//
//   ENGINE                                  PILL      WHY
//   phase 'ended'                           ended     terminal; nothing wakes it
//   parked === true (or phase 'parked')     idle      query torn down; resumable, not gone
//   activity 'working'                      working   mid-turn, running tools
//   activity 'awaiting_permission'          working   ALSO mid-turn — the SDK is blocked on a
//                                                     canUseTool promise, one click from
//                                                     continuing. "idle" would be a lie.
//   activity 'idle'                         idle      between turns
//   activity 'awaiting_peer'                idle      posted; the other machine has it
//   activity 'awaiting_inbound'             idle      reply HELD for an Accept; running nothing
//   activity 'parked'                       idle      (the parked branch above wins)
//   anything else / absent                  idle      fallback
//
// ⚠ PRECEDENCE IS PHASE-FIRST for the two terminal-ish answers, ACTIVITY-SECOND for the rest:
// `phase` and `activity` deliberately disagree in normal operation (a still-pending gate card
// keeps its phase while activity moves; a park lands with phase 'awaiting_inbound' when a
// message is held). Reading one field is how the predecessor got it wrong.
// ⚠ FALLBACK IS 'idle' BY CHOICE. "working" over a dead session makes the operator wait with no
// natural end and no feedback; "idle" over a working one only makes them re-ask.
//
// ⚠ STILL NO 'thinking' PILL, AND THE REASON MOVED (2026-08-20). The obstacle this header used
// to name — that `pillState`'s input says nothing about what has been RENDERED this turn — is
// SOLVED by session-detail.js. What keeps the PILL at three values is now a harder fact: `state`
// is the SERVER's vocabulary, and one row carrying a fourth value 400s the whole push,
// unretryably, forever. The finer signal rides BESIDE it as `detail` + `toolLabel`, local-only.

const PILL_WORKING = 'working';
const PILL_IDLE = 'idle';
const PILL_ENDED = 'ended';
const PILL_STATES = [PILL_WORKING, PILL_IDLE, PILL_ENDED];

// Activity half of the table above, written out in full (including rows agreeing with the
// fallback) so it reads as the engine's real activity list, not special cases over a default.
const ACTIVITY_PILL = {
  working: PILL_WORKING,
  awaiting_permission: PILL_WORKING,
  idle: PILL_IDLE,
  awaiting_peer: PILL_IDLE,
  awaiting_inbound: PILL_IDLE,
  parked: PILL_IDLE,
};

// IS THE SDK QUERY TORN DOWN? The ONE predicate behind both `pillState`'s idle branch and
// `listeningState`, so the two can never disagree about one session.
// ⚠ `parked` IS THE HONEST SIGNAL, NOT `s.query`. A park runs `abortQuery` and a spawn-idle
// session never built a query, so `parked` covers both — and the AUTH HOLD too, which sets
// `parked: true` (a hold IS a park). Reading the live handle would work and is refused because
// everything below the sentinel derives from reducer STATE and holds no runtime handle.
function queryTornDown(st) {
  return st.parked === true || st.phase === 'parked';
}

/**
 * Engine state -> pill state. The whole mapping, and the only place it is made.
 * ⚠ OWN-PROPERTY check, never a bare index: a plain object literal answers a FUNCTION for
 * 'constructor' / 'toString', and a function is truthy, so both would pass as pill states.
 */
function pillState(state) {
  const st = state || {};
  if (st.phase === 'ended') return PILL_ENDED;
  if (queryTornDown(st)) return PILL_IDLE;
  const known = Object.prototype.hasOwnProperty.call(ACTIVITY_PILL, st.activity);
  return known ? ACTIVITY_PILL[st.activity] : PILL_IDLE;
}

// IS THIS SESSION STILL LISTENING? (2026-08-22, Samuel's ruling.) It SPLITS THE `idle` PILL,
// which covers two states an operator cannot tell apart and must:
//   LISTENING  query ALIVE, between turns. A message is PUSHED onto the open prompt iterator
//              and answered at once. Reads "Waiting".
//   NOT        query torn down (idle-timer park, spawn-idle never woken, sign-in hold). A
//              message must RELAUNCH it — `wakeEffects` fires `resumeQuery`, rebuilding the
//              controller and iterator. Reads "Idle".
// Seconds versus a cold start, and the operator's next move differs.
// ⚠ DERIVED, NEVER STORED, and the NEGATION of the predicate the idle pill already uses — one
// fact, two readers, which is the defect this module exists to prevent.
// ⚠ ENDED IS CHECKED FIRST: `parked` is false on a settled session, so the bare predicate would
// answer true for something with no process at all.
// ⚠ LOCAL ONLY — it never reaches `channel_sessions` (`reportRow` picks columns by name); the
// cross-machine vocabulary stays three coarse values (INVARIANTS §11). A peer cannot act on it.
function listeningState(state) {
  const st = state || {};
  if (st.phase === 'ended') return false;
  return !queryTornDown(st);
}

// ─── END SESSION-PILL-PURE ───────────────────────────────────────────────────────────

module.exports = {
  PILL_WORKING,
  PILL_IDLE,
  PILL_ENDED,
  PILL_STATES,
  ACTIVITY_PILL,
  queryTornDown, // the ONE predicate behind the idle pill and `listeningState`
  pillState,
  listeningState, // 2026-08-22: Waiting (query alive) vs Idle (torn down) — local only
};
