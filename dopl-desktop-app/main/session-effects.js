// session-effects.js — the reducer's EFFECT BUILDERS (pure).
//
// ⚠ Every function returns a side-effect-FREE effect descriptor ({ type, ... }) — never a
// callback, never a live handle. session-engine.js EXECUTES them; nothing here reads or writes.
// ⚠ NO electron / SDK / fs / require references inside the sentinel block: test/_reducer-block
// .mjs slices it, PREPENDS it to the session-reducer block and evaluates the pair verbatim in
// plain Node. session-reducer.js requires these names ABOVE its own sentinel, so inside its
// block they are free vars.

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

// The effect set shared by every end (operator End, turn/cost cap): abort the query, tell the
// renderer, settle the record. ⚠ Leaves the channel TASK untouched — no task_finished, and
// since thread closing was removed (wiring plan Phase 4, 2026-08-18) there is no other end that
// touches it either. A real end ALSO posts a CALM lifecycle so the web card stops pulsing
// "Working…". ⚠ Idle never reaches here; it PARKS instead.
function endedEmit(state, outcome, reason, summary) {
  const payload = { type: 'ended', outcome: outcome, totalCostUsd: state.costUsd, reason: reason };
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
  interrupted: 'Interrupted',
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

// ⚠ A CAP END NAMES THE NUMBER IT HIT (2026-09-05, task 9(c); #1101 item 4c). "Turn limit
// reached" told the operator a limit existed and not which one, and as of task 9(a) that is
// genuinely ambiguous: the default is ISSUER-KEYED, so the same sentence means 200 on a session
// the operator launched and 24 on one an agent launched, and a set cap means neither.
// ⚠ THE NUMBER IS READ OFF THE ENDED RECORD, NEVER RE-DERIVED (#1179). `state.turnCap` is the cap
// this session actually ran under — `session-engine.js › readCaps` resolved it at launch and
// PREFERS the persisted value across a resume, so a session that crashed at turn 80 and came back
// still reports the cap it was really counting against. Calling `settings.getTurnCap()` here
// would answer today's setting for a default tier this session may not be in, and would name the
// wrong number on the one card that exists to explain the end.
// ⚠ AND IT DEGRADES TO THE OLD SENTENCE rather than to a wrong one. An unlimited session cannot
// reach this branch at all (`UNLIMITED_TURN_CAP` is Infinity), but a legacy or hand-mangled
// record with no finite cap still gets a true line instead of "reached (Infinity turns)".
function turnCapBody(state) {
  const n = state && state.turnCap;
  if (!Number.isFinite(n) || n <= 0) return 'Turn limit reached';
  return `Turn limit reached (${n} turn${n === 1 ? '' : 's'})`;
}

function endLifecycle(reason, state) {
  if (reason === 'turn_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: turnCapBody(state) };
  if (reason === 'cost_cap') return { type: 'lifecycle', kind: 'task_failed', extra: { capped: true }, body: 'Cost limit reached' };
  if (reason === 'operator') return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: 'Session ended' };
  // C-5: the 12h abandonment and the launch watchdog (C-4). ⚠ "and the LRU eviction" stood
  // here until 2026-08-20; there is no eviction (see the header).
  if (reason === 'abandoned' || reason === 'inactive') {
    return { type: 'lifecycle', kind: 'task_progress', extra: { session_ended: true }, body: INACTIVE_NOTE };
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
// ⚠ WHY THE REASON AND NOT THE ACTION. A cap is reached INSIDE the `result` action
// (`session-reducer.js` :239/:242), so it HAS no action type of its own and `entryFor` can never
// see it. The `ended` emit is the one place all five converge already knowing which it was.
//
// ⚠ THIS IS A SECOND AUDIENCE, NOT A SECOND COPY OF `endLifecycle`. That table writes to the
// CHANNEL, where the peer reads it, and it deliberately says one calm thing for both
// `abandoned` and `inactive` — which of the two it was is a fact about the operator's machine
// and none of a counterparty's business (see the header). This table writes to the operator's
// OWN window, where that privacy argument does not apply and the distinction is the whole
// value, so the two ends are named apart here and only here.
//
// ⚠ THE CAP LINE IS `turnCapBody`, CALLED NOT COPIED, so the window and the peer's card can
// never name two different numbers for one ending. That was the point of reading the cap off the
// ended record (#1179); a second literal here would undo it the first time the default moved.
// ⚠ AN UNKNOWN REASON RENDERS ITSELF rather than nothing. A reason this table has not learned yet
// is still more than the silence A9 is about, and a future `endEffects` caller that forgets to
// add its copy here degrades to a visible raw word instead of vanishing.
// ⚠ NO EM DASH (Samuel's copy rule). The line it replaces, `'Ended — inactive'`, carried one.
function endedStatusText(reason, state) {
  if (!reason || typeof reason !== 'string') return null;
  if (reason === 'turn_cap') return turnCapBody(state);
  if (reason === 'cost_cap') return 'Cost limit reached';
  if (reason === 'operator') return 'Ended by you';
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
  return !!state && (state.toolMode !== 'manual' || state.messageMode !== 'ask');
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
  if (o.lifecycle === true) effects.push(endLifecycle('inactive')); // the peer is told, once
  if (resetPosture) {
    // ⚠ A park that DISARMS both axes says so — a silent reset leaves the control reading "on"
    // over a session that will ask again.
    effects.push(modesEmit({ toolMode: 'manual', messageMode: 'ask' }));
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
  endedStatusText, // A9: the same end, worded for the operator's own window
  endEffects,
  modesEmit,
  parkEffects,
  postureWasReset, // did this park actually take a posture away?
  POSTURE_RESET_NOTE,
  INACTIVE_NOTE, // the one wording all three silent terminals use
};
