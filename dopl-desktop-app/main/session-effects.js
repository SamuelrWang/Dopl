// session-effects.js — the reducer's EFFECT BUILDERS (pure).
//
// ⚠ Every function returns a side-effect-FREE effect descriptor ({ type, ... }) — never a
// callback, never a live handle. session-engine.js EXECUTES them; nothing here reads or writes.
// ⚠ NO electron / SDK / fs / require references inside the sentinel block: test/_reducer-block
// .mjs slices it, PREPENDS it to the session-reducer block and evaluates the pair verbatim in
// plain Node. session-reducer.js requires these names ABOVE its own sentinel, so inside its
// block they are free vars.
const { toolModesOf } = require('./session-state'); // a hold resets to THIS session's narrowest word

// ─── BEGIN SESSION-EFFECTS (pure; unit-tested via source extraction) ─────────

// ⚠ A PENDING inbound card WINS the displayed status: `phase` carries the gate (nothing may
// clobber it while a card waits, so the pill keeps reading "Message waiting") while `activity`
// tells the truth, so the send button still morphs to Pause on a mid-flight turn.
function gatePhase(state, phase) {
  return state && state.hasPendingInbound === true ? 'awaiting_inbound' : phase;
}

// ⚠ THE SAME RULE FOR `activity`, AND IT WAS MISSING (2026-08-25). `gatePhase` above protects the
// PHASE from being clobbered while an inbound card waits, and nothing protected the ACTIVITY from
// being clobbered while a PERMISSION is held.
//
// THE DEFECT IT CLOSES, measured on a live channel of six windowless agents. A windowless
// `dopl_channel op=post` that gates bridges to a consent row and HOLDS — `session-windowless.js ›
// bridgeOutbound` polls that row for as long as the operator takes, which in the incident was
// minutes. The reducer's `permission_request` branch correctly parks the session at
// `activity: 'awaiting_permission'`, which `session-detail.js › detailFor` renders as the honest
// "Waiting on you". But the `outbound_post` branch then wrote `activity: 'working'`
// UNCONDITIONALLY — so the agent's NEXT post (a fresh turn, fed by the channel fan-out while the
// FIRST post was still undecided) flipped the card back to "Sending a message" with the consent
// row still sitting there pending. The operator sees an agent that looks busy and is in fact
// stopped, waiting on them, with no surface saying so. That is the exact complaint this was found
// under: "stuck working · thinking, burning tokens, nothing lands".
//
// ⚠ IT IS A DISPLAY TRUTH RULE, NOT A GATE. Nothing here decides anything, holds anything or
// resolves anything — the permission is already held by `pendingPermissions` and the decision
// still comes from the consent row. This only stops the session CLAIMING to be doing work it is
// blocked from doing.
//
// ⚠ WIDEN-ONLY IN ONE DIRECTION, deliberately: it can hold `awaiting_permission`, never invent it.
// A state with nothing pending returns the caller's value untouched, so every path that legitimately
// resumes work is unaffected.
function gateActivity(state, activity) {
  const pending = state && state.pendingPermissions;
  return pending && pending.length > 0 ? 'awaiting_permission' : activity;
}

// The effect set shared by every end (operator End, and the ends that remain): abort the query, tell the
// renderer, settle the record. ⚠ Leaves the channel TASK untouched — no task_finished, and
// since thread closing was removed (wiring plan Phase 4, 2026-08-18) there is no other end that
// touches it either. A real end ALSO posts a CALM lifecycle so the web card stops pulsing
// "Working…". ⚠ Idle never reaches here; it PARKS instead.
function endedEmit(state, outcome, reason, summary) {
  // 🔒 ⚠ **`totalCostUsd` RODE THIS PAYLOAD AND IS DELETED (2026-09-22, Samuel: *"we dont need
  // cost tracking"*).** It was the ONLY place `state.costUsd` ever left the reducer, and the one
  // consumer it ever had was a cap that was deleted on 2026-09-07 — since then it crossed the IPC
  // boundary to a renderer that reads `type`, `outcome`, `reason` and `summary` and has never
  // named it. ⚠ `state` STAYS IN THE SIGNATURE: `endedEmit` is called from four sites and the
  // parameter is what a later field would ride; deleting it would be a churn this ruling did not
  // ask for.
  const payload = { type: 'ended', outcome: outcome, reason: reason };
  if (summary !== undefined) payload.summary = summary;
  return { type: 'emit', payload: payload };
}

// The calm lifecycle a real end posts. All ride metadata like `interrupted` — no server-stamped
// keys, and nothing that touches the thread row. Any other reason posts nothing.
//
// ⚠ A LOCAL SESSION ENDING IS NOT A THREAD FAILURE. `task_failed` is TERMINAL whatever metadata
// rides it: group-thread.ts folds it into `endEvent` and computeStatus reads a terminal marker
// as the exchange's OUTCOME, so one member parking their own window paints the SHARED thread as
// failed on the peer's card. The operator End therefore posts a NON-TERMINAL `session_ended`:
// kind `task_progress`, which group-thread treats as an ENTRY and never as an endEvent, while
// still reaching `calmEndStatus` so the card stops saying "Working…".
// ⚠ A METADATA MARKER, NOT A NEW KIND: `channel_messages.kind` carries a CHECK constraint, so a
// first-class `session_ended` kind is a schema change deployed ahead of every desktop that
// would write it, for a render hint. The marker is reserved server-side like the calm flags.
// ⚠ THE CAPS STAY TERMINAL: a turn/cost cap is this machine refusing to continue, not a window
// being tidied away, and the peer is owed that as an outcome.
//
// ⚠ THE SILENT TERMINALS MUST POST. `abandoned` (the COMMON path: request -> task_started ->
// 15min idle -> silent park -> 12h -> end) and the auth-preflight hold (`launch()` answers with
// a sessionId, so trigger.js takes the success branch and no query ever runs) each used to post
// NOTHING, so the requester's card pulsed "Working…" indefinitely on exactly the endings nobody
// chose.
// ⚠ IT WAS THREE, AND THE THIRD IS GONE (corrected 2026-08-20): "the window-budget EVICTION
// (`settle()` bypasses the reducer)". That LRU went with the window (`session-park.js`), and
// the surviving ceiling REFUSES a launch rather than reclaiming a live session — so no session
// is ever ended to make room, and "a window budget reclaimed" is not one of the things this
// note has to avoid saying.
// ⚠ ONE WORDING FOR BOTH: which of the two it was is a fact about the OTHER machine (nobody
// came back; no Claude Code credential), and the second would report the operator's
// circumstances to a counterparty. No blame, no cause, no em dash.
// A real terminal arriving later cannot double-post: `trigger-outcomes.js › onEnded` drops a
// repeat of the same (thread, cycle) marker, and the deterministic clientMsgId dedupes it
// server-side. ⚠ That reader said `session-window.onEnded` until 2026-08-20 — the module is
// deleted and the handler MOVED (its own header records the move), so the dedupe is live and
// the citation was not.
const INACTIVE_NOTE = 'This session went inactive.';

// ── ⚠ THE AUTH HOLD STOPPED BORROWING THAT SENTENCE (2026-09-15, Samuel's ruling via the
// badge trace: *"should an auth-hold park post 'went inactive' at all? it reads as agent death
// when it's a credential pause"*) ─────────────────────────────────────────────────────────────
//
// A HOLD IS A PARK, NOT AN END. `session-reducer.js › auth_hold` keeps the session durable and
// REOPENABLE — it relaunches through `startQuery` the moment the operator signs in — so the one
// sentence it was posting described a state the session was not in. The peer read "went
// inactive" and reasonably stopped waiting.
//
// ⚠ IT STILL POSTS, AND THAT HALF IS C-5's AND UNCHANGED. Deleting the note outright was the
// other candidate and it reinstates the exact defect C-5 was raised to fix on THIS path: a
// preflight hold runs no query at all, so without a post there is nothing on the wire and the
// requester's card pulses "Working…" over a machine nobody has signed in on. What changes is
// the CLAIM, not the courtesy.
// ⚠ NO LOCAL DETAIL, the same fence `INACTIVE_NOTE` carries: it says this side is paused and
// needs a person, never which vendor's credential lapsed or what the operator must click. That
// is the LOCAL notification's job.
// ⚠ IT IS NOT THE SAME STRING AS `AUTH_HELD_REPLY` (trigger-outcomes.js) AND MUST NOT BE
// FACTORED INTO ONE. That one is a REPLY this machine sends to a peer whose request it is
// declining to pick up ("I'll pick it up once that's sorted"); this is a STATUS NOTE about a
// session already under way. Two audiences, two moments, and merging them would put a promise
// to answer on a session that has already stopped answering.
// ⚠ No em dash (Samuel's copy rule).
const AUTH_HELD_NOTE = 'This session is paused: the agent sign-in on this machine needs attention.';

// ── ⚠ AN END NOBODY ASKED FOR SAYS SO (2026-09-15, Samuel's ruling via the badge trace:
// *"should park-on-claim ends say WHY in the post? that's the 'random' feeling, name the
// cause"*) ────────────────────────────────────────────────────────────────────────────────────
//
// `session-park-on-claim.js` ends every live session in a container that has just gained a
// person. It reached the reducer's `{type:'end'}` — the OPERATOR's own End — so the transcript
// said `Session ended` and was indistinguishable from a click nobody made, minutes after an
// unrelated membership change. That is the largest single source of the "it happens at random"
// report (AGENT-BADGE-TRACE.md §3.1, T5).
//
// ⚠ THE CAUSE IS SAYABLE HERE AND THE OTHER TWO SILENT ENDS' CAUSES ARE NOT, which is why this
// is not a reversal of the no-blame rule above. "Nobody came back" and "this machine has no
// credential" are facts about the OPERATOR that a counterparty is not owed; "a person joined
// this channel" is a fact about the CHANNEL, already visible to everyone reading the note, and
// it is the one that explains an ending the operator did not choose either.
// ⚠ It names no member: WHO joined is not what makes the ending make sense, and naming them
// would put a person's arrival in a sentence about an agent stopping.
const CLAIMED_NOTE = 'Session ended because a person joined this channel.';

// ── ⚠ A TERMINAL POST MUST SAY WHY, AND THE METADATA ALREADY KNOWS (2026-08-22, Samuel) ──────
//
// A `task_failed` shipped with NO BODY while its own metadata carried the reason — `{interrupted}`,
// `{declined}`, `{dropped}`, `{capped}` — so the requester's card fell back to a generic failure
// on endings that were not failures at all. The flag decides the RENDER; the body is what a person
// reads, and leaving it undefined threw away a fact this process was already holding.
//
// ⚠ TWO OF THE FOUR HAVE NO PRODUCER LEFT, AND THEY ARE NAMED ANYWAY. `{declined}` and
// `{dropped}` were `trigger-outcomes.js`'s inbound-consent terminals, deleted 2026-08-22 with the
// approve-IN lane (`main/trigger.js`'s header carries the ruling). They stay in this table
// because `CALM_FLAG_KEYS` stay reserved server-side (INVARIANTS §5), installed builds still
// write them, and the WEB still renders them — so the copy has to exist for the flag, not for
// this build's producers.
//
// ⚠ AND `onEnded` CURRENTLY POSTS ONLY `task_progress`, so these bodies reach nobody TODAY. That
// is a fact about which KINDS the desktop posts, not about the rule: the rule is "a terminal
// carries its reason", and it must already be true on the day a terminal kind posts again. A body
// added later, under pressure, is how the generic failure came back the first time.
const TERMINAL_BODIES = {
  // ⚠ 'Interrupted' UNTIL 2026-09-13, WHEN SAMUEL TOOK THE EXPLANATION AWAY: "We don't need that
  // line to be there … We can just put 'ended.' We don't need to give a reason why." The word is now
  // the SAME word the Agents-tab pill uses (`agent-bits.tsx › AgentEndedPill`), which is the point
  // — one ending, one word, wherever a person reads it. The FLAG is untouched: `{ interrupted: true }`
  // still rides the metadata, and the web's own receipt chip still reads it (`lib/message-receipt.ts
  // › RECEIPT_LABEL.interrupted`, a peer-side vocabulary that is reserved server-side, INVARIANTS §5).
  interrupted: 'Ended',
  capped: 'Limit reached',
  declined: 'Request declined',
  dropped: 'Reply was not sent',
};

// The calm one-liner for a terminal's metadata, or undefined when nothing in it explains the end
// (a REAL error, which is exactly the case that should read as a bare failure).
// ⚠ ORDER IS FIXED BY THE KEY LIST, not by object iteration on the caller's shape, so two flags
// on one post can never produce two different bodies on two machines.
const TERMINAL_FLAG_ORDER = ['declined', 'dropped', 'interrupted', 'capped'];
function terminalBody(extra) {
  const e = extra || {};
  for (const key of TERMINAL_FLAG_ORDER) if (e[key] === true) return TERMINAL_BODIES[key];
  return undefined;
}

// 🔒 `turnCapBody` STOOD HERE AND IS DELETED (2026-09-07, Samuel's ruling), along with the
// `turn_cap` and `cost_cap` arms of both tables below. This is the completion of the deletion
// rather than tidying after it: these lines are how the app SAYS a session was capped, and an
// app that can no longer cap one must not keep the sentence. A dead branch that renders "Turn
// limit reached" is a message waiting for a bug to make it reachable again.
// ⚠ THE `capped: true` LIFECYCLE EXTRA GOES WITH THEM. It was the peer-visible half — a card on
// the counterparty's thread saying this side stopped at a limit — and no producer sets it now.

// ── ⚠ WHICH END THIS IS, DECIDED ONCE (2026-09-15) ───────────────────────────────────────────
//
// The reducer's `{type:'end'}` is reached by six callers (AGENT-BADGE-TRACE.md §3.1) and only
// one of them is the operator pressing End. A caller may therefore NAME its end, and this is the
// closed set of names plus the fallback — in the PURE block, beside the two tables that have to
// have a sentence for every value it can return, so a name added without copy fails the suite
// rather than shipping a session that ends in a word nobody wrote.
//
// ⚠ ONE VALIDATOR, NOT TWO. `session-reopen.js › controlByTask` FORWARDS a caller's reason and
// does not police it: a second closed set there would be a second vocabulary, and the two would
// disagree the first time one of them gained a member.
// ⚠ AN UNKNOWN NAME IS THE OPERATOR'S OWN End, never silence. `endLifecycle` returns null for a
// reason it does not know, and null is NO POST — so failing toward `operator` is what keeps a
// mislabelled end from quietly telling the waiting peer nothing at all.
// ⚠ IT MAY ONLY CHOOSE COPY. Nothing downstream branches on the reason except the two wording
// tables and `keepWindow` (the abandonment's, which no caller can name), so naming one widens
// nothing and ends nothing an unnamed call could not already end.
const END_EVENT_REASONS = ['claimed']; // `session-park-on-claim.js`'s sweep, and nothing else yet
function endReasonOf(event) {
  const named = event && typeof event.reason === 'string' ? event.reason : null;
  return named && END_EVENT_REASONS.indexOf(named) !== -1 ? named : 'operator';
}

function endLifecycle(reason, state) {
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: 'Session ended' };
  // 2026-09-15: the park-on-claim sweep, which is an END the operator did not ask for. Same
  // shape as the operator's own End (it IS terminal, and it keeps no window); only the sentence
  // differs, because only this one has a cause a counterparty may be told. See CLAIMED_NOTE.
  if (reason === 'claimed') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: CLAIMED_NOTE };
  }
  // C-5: the 12h abandonment and the launch watchdog (C-4). ⚠ "and the LRU eviction" stood
  // here until 2026-08-20; there is no eviction (see the header).
  if (reason === 'abandoned' || reason === 'inactive') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: INACTIVE_NOTE };
  }
  // 2026-09-15: the AUTH HOLD, which is a PARK and no longer borrows the sentence above.
  // ⚠ IT KEEPS `session_ended: true`, and that is deliberate rather than an oversight: the flag
  // is RESERVED SERVER-SIDE and has no client reader left (`session-inactive-notice.test.mjs`
  // pins that `SESSION_ENDED_KEY` is gone), so it makes no claim a person can read — what it
  // still does is drive `trigger-outcomes.js › firstInactiveNote`, the once-per-(thread, cycle)
  // guard. Dropping it would silently un-dedupe this note and a converging hold could say it
  // twice, which is the failure C-5 spent its own guard preventing.
  if (reason === 'auth_hold') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: AUTH_HELD_NOTE };
  }
  return null;
}

// ── ⚠ THE SAME END, SAID TO THE OPERATOR'S OWN WINDOW (2026-09-06, A9; filed at #1209) ────────
//
// THE DEFECT. `endedEmit` has always carried `reason`, and NOTHING read it. The work stream got a
// line for exactly two of the five ends, minted from the DISPATCH ACTION's type rather than from
// the reason — so a turn cap, a cost cap and an abandonment ended the session in silence. The
// turn cap is the one that cost Samuel real time: an agent stops at 24 turns and its own window
// never says why.
//
// ⚠ WHY THE REASON AND NOT THE ACTION. The argument was written for the CAPS — reached inside the
// `result` action, so they had no action type of their own and `entryFor` could never see them.
// The caps are deleted (2026-09-07) and the argument outlives them: the `ended` emit is still the
// one place every end converges already knowing which it was, which is what keeps a new end from
// having to invent a second route to the same window.
//
// ⚠ THIS IS A SECOND AUDIENCE, NOT A SECOND COPY OF `endLifecycle`. That table writes to the
// CHANNEL, where the peer reads it, and it deliberately says one calm thing for both
// `abandoned` and `inactive` — which of the two it was is a fact about the operator's machine
// and none of a counterparty's business (see the header). This table writes to the operator's
// OWN window, where that privacy argument does not apply and the distinction is the whole
// value, so the two ends are named apart here and only here.
//
// ⚠ AN UNKNOWN REASON RENDERS ITSELF rather than nothing. A reason this table has not learned yet
// is still more than the silence A9 is about, and a future `endEffects` caller that forgets to
// add its copy here degrades to a visible raw word instead of vanishing.
// ⚠ NO EM DASH (Samuel's copy rule). The line it replaces, `'Ended — inactive'`, carried one.
function endedStatusText(reason, state) {
  if (!reason || typeof reason !== 'string') return null;
  // 2026-09-07: `turn_cap` and `cost_cap` arms deleted with the caps.
  if (reason === 'operator') return 'Ended by you';
  // 2026-09-15: the park-on-claim sweep. ⚠ The operator's OWN window gets the fuller sentence —
  // the privacy argument that keeps the channel note short does not apply on this side, and
  // "why did my agent stop" is the whole question this line exists to answer.
  if (reason === 'claimed') return 'Ended because a person joined this channel';
  if (reason === 'inactive') return 'Ended after going inactive';
  // ⚠ NOT "after 12 hours": the bound is `ABANDONED_MS` and a number spelled here is a second
  // place to change, which is how the cap line went wrong before #1179.
  if (reason === 'abandoned') return 'Ended after being left parked';
  return reason;
}

// ⚠ AN ABANDONMENT KEEPS ITS WINDOW. Every other end is something the operator watched happen;
// an abandonment fires hours later with nobody present, and destroying the window makes a
// transcript vanish from the desktop of someone who stepped away — indistinguishable from a
// crash. Costs nothing: `phase: 'ended'` is what stops a peer reply, a stale dock click or a
// drained SDK tail from waking the session, and `settle` still denies every pending permission,
// closes the iterator, aborts the query and drops the map entry.
function endEffects(state, outcome, reason, summary) {
  const lc = endLifecycle(reason, state);
  return [{ type: 'abortQuery' }].concat(lc ? [lc] : [],
    [endedEmit(state, outcome, reason, summary),
      { type: 'settle', outcome: outcome, keepWindow: reason === 'abandoned' }]);
}

// The header posture echo: ⚠ ONE shape for BOTH axes, so the renderer never sees half a one.
function modesEmit(state) {
  return { type: 'emit', payload: { type: 'modes', tool: state.toolMode, message: state.messageMode } };
}

// ⚠ A PARK THAT TAKES THE POSTURE AWAY MUST SAY SO — otherwise the selects just move and the
// experience is "I set Bypass and it keeps turning itself off" with no event to attach it to.
// ⚠ Emitted ONLY when there was really something to reset, so it can never claim a change that
// did not happen. Belongs to the ONE park that still resets: the AUTH HOLD.
// Copy lives in main because main knows whether the reset happened; it goes out as an ordinary
// `notice`, which the view-model renders via textContent. No em dash.
const POSTURE_RESET_NOTE = 'Paused. Tools and Messages reset to Manual / Ask.';
function postureWasReset(state) {
  return !!state && (state.toolMode !== toolModesOf(state)[0] || state.messageMode !== 'ask');
}

// Idle PARKS the session, never ends it: deny any awaited canUseTool promise fail-closed, tear
// down the live query, clear the idle timer, persist phase 'parked', tell the renderer.
// ⚠ NOT settled: no `settle`, no `win.destroy`, no registry removal, and sdkSessionId is
// RETAINED so a lazy wake can resume it.
//
// TWO PARKS, TWO POSTURE ANSWERS, explicit at both call sites:
//   `resetPosture: true`  (default; AUTH_HOLD) — disarm both axes and SAY SO. A hold is a
//                         session whose credential is gone; it relaunches through startQuery.
//   `resetPosture: false` (IDLE park) — ⚠ the operator's posture is theirs for the session. No
//                         modes echo, no note: the renderer's selects move ONLY on a `modes`
//                         event, so they go on showing what the operator set.
//   `lifecycle: true`     ⚠ AUTH HOLD ONLY. A preflight hold answers `launch()` with a
//                         live-looking sessionId, so trigger.js takes its success branch and
//                         NOTHING is posted — no task_started, no reply, no end — while the
//                         requester's card pulses. The IDLE park must NOT pass it: it is a
//                         15-minute pause the operator is expected back from, and its
//                         abandonment bound already posts if they are not. Idempotent for
//                         free — the reducer's auth_hold branch returns no effects once
//                         `authHeld` is set.
//                         ⚠ SINCE 2026-09-15 THE NOTE IT PUSHES IS THE HOLD'S OWN
//                         (`AUTH_HELD_NOTE`), not `INACTIVE_NOTE`. The flag is still spelled
//                         `lifecycle` rather than renamed to the reason: it is the only park
//                         that posts at all, so the boolean still answers the question the call
//                         sites ask, and `endLifecycle('auth_hold')` is where the wording lives.
//   `armAbandon: true`    RE-ARMS the timer instead of clearing it. session-engine's
//                         scheduleIdle reads `parked` off the state just stored, so this arms
//                         the hours-scale ABANDONMENT bound (`abandon_timeout`), never another
//                         15-minute idle TTL. ⚠ IDLE park only: an auth-held session waits on a
//                         human clicking "Sign in", and ending it destroys that button.
function parkEffects(state, opts) {
  const o = opts || {};
  const resetPosture = o.resetPosture !== false;
  const effects = [
    { type: 'denyPending' },
    { type: 'abortQuery' },
    o.armAbandon === true ? { type: 'scheduleIdle' } : { type: 'clearIdle' },
    { type: 'persist', phase: 'parked' },
  ];
  if (o.lifecycle === true) effects.push(endLifecycle('auth_hold')); // the peer is told, once — a PAUSE, not an ending (2026-09-15)
  if (resetPosture) {
    // ⚠ A park that DISARMS both axes says so — a silent reset leaves the control reading "on"
    // over a session that will ask again.
    effects.push(modesEmit({ toolMode: toolModesOf(state)[0], messageMode: 'ask' }));
  }
  effects.push({ type: 'emit', payload: { type: 'status', phase: gatePhase(state, 'parked') } });
  // `paused` drops the one-line inline note (renderer owns the copy), distinct from the reopen
  // shell's `notice`. ⚠ A park while a message is HELD says so — "wait for a reply" is wrong
  // when the reply is already here.
  effects.push({ type: 'emit', payload: state && state.hasPendingInbound === true ? { type: 'paused', gated: true } : { type: 'paused' } });
  if (resetPosture && postureWasReset(state)) {
    effects.push({ type: 'emit', payload: { type: 'notice', level: 'info', text: POSTURE_RESET_NOTE } });
  }
  // ⚠ Clear the renderer's permission dock for anything awaiting a button: main denies each
  // fail-closed (denyPending) before the abort, so a parked, query-less session must not keep
  // showing a live-looking prompt.
  for (const id of (state && state.pendingPermissions) || []) {
    effects.push({ type: 'emit', payload: { type: 'permission_resolved', requestId: id, decision: 'deny' } });
  }
  return effects;
}

// ─── END SESSION-EFFECTS ─────────────────────────────────────────────────────

module.exports = {
  gatePhase,
  gateActivity, // 2026-08-25: a HELD permission outranks "working" on the ACTIVITY, as the gate does on the phase
  terminalBody, // 2026-08-22: a terminal post's body says what its metadata already knows
  TERMINAL_BODIES,
  endedEmit,
  endLifecycle,
  endReasonOf, // which end this is, from the event that caused it
  END_EVENT_REASONS, // the closed set a caller may name (the suite enumerates it)
  endedStatusText, // A9: the same end, worded for the operator's own window
  endEffects,
  modesEmit,
  parkEffects,
  postureWasReset, // did this park actually take a posture away?
  POSTURE_RESET_NOTE,
  // ⚠ "the one wording all three silent terminals use" UNTIL 2026-09-15: the AUTH HOLD took its
  // own sentence, so this is now the abandonment's and the launch watchdog's — the two that
  // really are endings with nothing sayable about their cause.
  INACTIVE_NOTE,
  AUTH_HELD_NOTE, // a PARK that needs a person, said without claiming an end
  CLAIMED_NOTE, // an end the operator did not ask for, saying what caused it
};
