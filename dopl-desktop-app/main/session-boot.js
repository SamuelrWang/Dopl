// session-boot.js — WHAT COMES BACK WHEN THE APP STARTS AGAIN, AND THE RULE THAT NOTHING MAY
// COME BACK AS NOTHING.
//
// ⚠ SPLIT OUT OF `main/session-engine.js` (F-694, 2026-09-13) UNDER THE §1 500-LINE CAP. That
// file stands at the cap with no headroom, which is the state ENGINEERING.md §2 warns about — a
// file at the cap does not merely stop growing, it stops being CORRECTABLE — so `init()` reaches
// this in ONE line and the reasoning lives here.
//
// THE SEAM IS REASON-TO-CHANGE, like `session-park.js` / `session-teardown.js` before it:
// `session-engine.js` owns the RUNNING session (the query, the effect table, the reducer
// dispatch) and `session-teardown.js` owns the terminal. This owns the ONE MOMENT BEFORE EITHER:
// what a durable record on disk becomes at app start. It changes when the durable record or the
// reload disposition changes; the engine changes when the loop does.
//
// ── THE INCIDENT (measured 2026-09-13) ───────────────────────────────────────────────────────
// A Dopl channel agent (`@agent-y1uun32v`, `phase: 'parked'`, sdk id present in the resume map,
// identity "Coder") was idle when Electron was hard-restarted. After the restart it was NOWHERE:
// no card in the Agents tab, not even an Ended one, no `agentHistory` entry, and its
// `channel_sessions` row gone — that row is a LIVE PROJECTION, deleted the moment the pill leaves
// the set the push reports.
//
// ⚠ THE CAUSE WAS A `continue`. `session-engine.js › init` loops the stored records and skips
// anything whose `store.reloadDisposition(rec.phase)` is not `'resume'` — and a parked record's
// disposition is `'dormant'`. So a parked record was neither RE-REGISTERED in the engine's
// in-memory `sessions` map (never published by `session-summary.js`, never re-projected to
// `channel_sessions`, unreachable by every wake path, which all resolve against that map) nor
// ENDED (no `setRecordPhase('ended')`, no `task_failed {interrupted}`, no history entry — so not
// even a tombstone). The record sat on disk describing an agent nothing in the product mentioned.
//
// ── THE RULE (F-694) — TWO OUTCOMES, NEVER A THIRD ───────────────────────────────────────────
//   RE-PARKED  a dormant record WITH an sdk id in the resume map, on a runtime that can resume:
//              the parked session object is rebuilt in `sessions` in the shape `session-park.js
//              › resumeParked` expects, so the summary publishes it as **Idle**, the push
//              re-projects its `channel_sessions` row, and the next addressed message wakes it
//              through the EXISTING lazy path (`session-gate.js › feedInbound` → the reducer's
//              `resumeQuery` → `resumeParked`). No query starts here and no runtime is acquired.
//   ENDED      anything else — INCLUDING a record last parked longer ago than `REPARK_WINDOW_MS`
//              (24h; the 2026-09-13 regression, see that constant's own section) — takes the
//              INTERRUPTED-END route — `setRecordPhase('ended')`, the
//              `task_failed {interrupted}` lifecycle, and an `agent-history.js` entry, which is
//              what makes an **Ended** card exist at all (`session-summary.js` reads its ended
//              set from that file). An agent the operator can see and read is the floor.
//
// ⚠ WHY A RUNTIME THAT REFUSES RESUME IS ENDED HERE RATHER THAN RE-PARKED. A refusal is a fact
// about the BUILD (`runtime/capability.js › resumeRefusal`, e.g. an unverified usage meter), not
// about the moment — so a re-parked pill on such a runtime would be Idle forever: visible,
// addressable, and silently unwakeable, which is exactly the third state this module exists to
// forbid. ⚠ IT CHANGES NOTHING ABOUT THE LIVE REFUSAL: `resumeParked` still refuses IN PLACE and
// leaves a running session parked for the next wake (INVARIANTS §11) — that is a session whose
// operator is present, and this is a record with nobody waiting on it. **The cost, stated rather
// than discovered:** a later build that verifies the meter cannot revive a record this path
// ended, because `reloadDisposition('ended')` is `'ignore'`.

const crypto = require('crypto');
const store = require('./session-store');
const { initialSessionState } = require('./session-state');
const { floorWindowlessMessage } = require('./session-profiles'); // AXIS B's windowless floor (F-236)
// ⚠ `contextFromRecord` AND `knownProfile` COME FROM `session-park.js`, NEVER A SECOND COPY. Both
// answer "what does a durable record mean" for the OTHER record-driven rebuild (`startResume`),
// and `knownProfile` in particular is fail-restrictive on purpose — a raw stored profile falls
// through `tool-profiles.js › normalizeProfile`'s global fallback and comes back at FULL access,
// from the least trustworthy input there is. A third spelling of that list is how one of them
// silently stops matching.
const sessionPark = require('./session-park');
const toolProfiles = require('./tool-profiles'); // item 9: the human posture label
const sessionSummary = require('./session-summary'); // §3.3: registration is a projection move
const agentHistory = require('./agent-history'); // what an ended agent leaves, for 7 days
const sessionEffects = require('./session-effects'); // `terminalBody` — a terminal says why
const runtimeRegistry = require('./runtime');
const runtimeCapability = runtimeRegistry.capability; // the ONE module allowed to read a descriptor's nulls
const runtimeTruth = require('./session-runtime-truth'); // requires nothing; the record's usage baseline (P4-01)
const { diag } = require('./diag');

// ─── BEGIN SESSION-BOOT-PURE (injectable; unit-tested via source extraction) ──────
// Everything above is a free var from here down. ⚠ NO IMPORT AND NO PLATFORM REFERENCE BELOW THIS
// LINE — the suite asserts it by source scan, so the one pass that runs before anything else in a
// restarted app stays drivable from a plain `new Function`.

let deps = null;

/**
 * The engine binds what this module may not require: its in-memory registry, the lifecycle
 * runner (`task_failed` reaches `trigger-outcomes.js` through it) and `scheduleIdle`.
 * ⚠ READ AT CALL TIME, so bind order at module load does not matter — `session-park.js › bind`'s
 * idiom, for the same reason.
 */
function bind(d) {
  deps = d || null;
}

// ── ⚠ THE RECENCY WINDOW (2026-09-13, Samuel — THE REGRESSION F-694's FIX SHIPPED WITH) ───────
//
// THE MEASUREMENT, minutes after the fix went live: "a bunch of the agents that were ended are now
// marked as idle and I'm really confused why that happened … that's kind of a serious issue."
// `~/Library/Application Support/dopl-desktop/config.json › sessionRecords` held **66** records at
// `phase: 'parked'` — 63 of them older than SEVEN DAYS, the oldest 46 days — and `reparkDormant`
// revived EVERY one of them as an Idle pill.
//
// ⚠ WHY THE STORE WAS FULL OF THEM, which is the part that makes this a regression and not a new
// bug: BEFORE the fix, a parked agent killed by a restart was left in `phase: 'parked'` FOREVER —
// neither ended nor live (that IS F-694). So the store accumulated months of records for agents
// Samuel ended in his head the day they stopped, and the first pass that read that phase honestly
// resurrected the whole backlog. `store.pruneRecords` never swept them either: `protectedRecord`
// retains any key with an sdk id in the resume map, which is every one of these.
//
// ⚠ THE WINDOW IS ABOUT THE OPERATOR, NOT ABOUT RESUMABILITY. Every one of those 66 is technically
// resumable — the conversation handle is right there. The question this pass actually has to answer
// is whether a person would recognise the pill: an agent parked this morning is one he is coming
// back to, and one parked six weeks ago is one he considers over. 24h is that line, and a dormant
// record outside it is not silently dropped — it takes the SAME interrupted-end route (Ended card +
// history entry), because "two outcomes and never a third" is the rule the window narrows, not an
// exception to it.
const REPARK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * WHEN THIS RECORD WAS LAST TOUCHED, or null when nothing on it says.
 * ⚠ MOST RECENT OF THE THREE, not the first one found: `parkedAt` (written at both park writes,
 * `session-store.js › stampParked`) is the true answer, `lastActivityAt` is honoured for any record
 * shape that grows one, and `startedAt` is the FLOOR — it is the only stamp the 66 measured records
 * carry, and for a record written before `parkedAt` existed it is the one honest lower bound on
 * freshness available (an agent that STARTED within the window cannot have been parked before it).
 * ⚠ null IS OLD at the caller, never unknown-means-recent.
 */
function recordFreshness(rec) {
  let best = 0;
  for (const field of ['parkedAt', 'lastActivityAt', 'startedAt']) {
    const n = Number(rec && rec[field]);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best > 0 ? best : null;
}

/** Is this dormant record one the operator could still have in mind? A missing stamp is OLD. */
function withinReparkWindow(rec, now) {
  const at = recordFreshness(rec);
  if (at === null) return false;
  return now - at <= REPARK_WINDOW_MS;
}

/**
 * A DORMANT RECORD -> THE PARKED SESSION OBJECT `resumeParked` EXPECTS.
 *
 * ⚠ IT IS NOT `startSession`, AND THE FOUR REASONS ARE THE WHOLE DESIGN. That function is the one
 * construction site for every SPAWN, and a boot rehydrate is not a spawn: (1) it needs a RUNTIME
 * handle to stamp `s.runtimeId`, and acquiring one at boot is an async probe per record that can
 * throw; (2) its windowless credential preflight ROLLS BACK — `sessions.delete(s.key)` — on a
 * signed-out machine, which is the invisibility this module exists to end, arriving by a second
 * door; (3) it mints a fresh `sessionId` and restamps `startedAt`, so the record's own identity
 * and its Agents-tab time bucket would be destroyed by the act of restoring it; (4) it writes a
 * fresh record and probes the runtime credential, per record, at app start.
 *
 * ⚠ SO THE FIELDS ARE COPIED FROM THE RECORD, and the three that cannot be are said out loud:
 *   `nonce`      MINTED FRESH. It is deliberately not persisted, and `startResume` — the other
 *                record-driven rebuild — mints one too. The SDK resume carries the original ROLE
 *                block, and every framed continuation states the token it is fencing with.
 *   `operatorUserId`  **null, which is FAIL-CLOSED and not a gap.** The record does not carry an
 *                owner, `setSelfIdentity` has not run at `init()` (the identity is resolved in
 *                `channel-listener.js`'s first reconcile, after it), and inventing one would
 *                re-attribute a session across a sign-out — the exact thing that stamp exists to
 *                prevent. `session-reopen.js › messageByTask` therefore refuses a DIRECTED 1:1
 *                until this session has actually been resumed; the ordinary channel wake path
 *                reads no stamp. ⚠ THE PUSH IS UNAFFECTED: `session-state-push.js › trackOrigin`
 *                stamps origin from the LIVE push identity per key, not from this field.
 *   `awaitingDirective`  **false, unlike a spawn-idle shell.** This agent has a conversation and
 *                has already been directed; `session-gate.js › feedInbound`'s belt fences that
 *                flag alone, and setting it would re-fence an agent that was past it.
 */
function parkedSessionFromRecord(key, rec, sdkId) {
  const state = initialSessionState({ mode: rec.mode, side: rec.side });
  // ⚠ THE WINDOWLESS MESSAGE FLOOR (F-236). A rehydrated session has NO accept surface, and a
  // message axis left at the reducer's `ask` makes `session-gate.js › enqueue` HOLD the peer's
  // next reply with nothing left able to release it. The SAME shared rule `startSession` applies.
  state.messageMode = floorWindowlessMessage(state.messageMode);
  // The spent counter, rehydrated for DISPLAY (the caps are deleted, 2026-09-07) — a resumed
  // agent must show what it has already run rather than reading as fresh.
  // 2026-09-22: `state.costUsd = Number(rec.costUsd) || 0` stood beside it, deleted with cost.
  state.turns = Number(rec.turns) || 0;
  // PARKED, all three fields: `phase` is what the durable record round-trips, `parked` is what
  // `session-pill.js › queryTornDown` reads (hence the Idle pill and `listening: false`), and
  // `activity` is the coarse word. The reducer's `wakeEffects` fires `resumeQuery` off `parked`.
  state.phase = 'parked';
  state.parked = true;
  state.activity = 'parked';
  const profile = sessionPark.knownProfile(rec.profile);
  // ── ⚠ THE DELTA BASELINE A RESTART REBUILDS (2026-09-22, CXP-4) ─────────────────────────────
  //
  // ⚠ THE INVARIANT IS THAT A BASELINE PAIRS WITH THE ACCUMULATOR ITS DELTAS ARE ADDED TO.
  // `session-io.js › applyCoreEvents` adds `platformTotal - baseline` to an accumulator on every
  // `result`, so the two must start level.
  // ⚠ THE TOKEN BASELINE IS A HARD `0` HERE, AND IT IS THE RULE RATHER THAN AN EXCEPTION:
  // `s.tokensSpent` is NOT in the durable record (`session-io.js › baseRecord`), so the token
  // accumulator restarts at 0 and its baseline must too. A wave that persists `tokensSpent` owes
  // this line the twin, and `capability.js › resumeZeroesBaseline` is the predicate it would ask.
  // 🔒 ⚠ **THERE WAS A SECOND BASELINE HERE UNTIL 2026-09-22 AND THE COST DELETION TOOK IT.**
  // `lastTotalCost` was `usageZeroes ? 0 : Number(rec.costUsd)`, because the COST accumulator WAS
  // restored from the record (`state.costUsd`, four lines up) and a zero baseline against a
  // CONTINUING runtime would have re-counted that whole restored figure on the first post-resume
  // turn. Neither the accumulator nor the record field exists now, so `usageZeroes` had no reader
  // left and went with them. ⚠ THE CXP-4 RULE IS UNTOUCHED: `recordedBaseline` below still crosses
  // into the rebuilt session as `usageBaseline`, and `session-park.js › resumeParked` still asks
  // `resumeZeroesBaseline` with it before deciding the TOKEN baseline on the very next resume.
  // ⚠ THE RECORD'S WORD DECIDES, NOT TODAY'S DESCRIPTOR — `capability.js › resumeZeroesBaseline`
  // states that precedence once, and `reparkDormant` below still gates the resume itself on the
  // LIVE descriptor's `resumeRefusal`, exactly as it did.
  const recordedBaseline = runtimeTruth.durableRuntimeTruth(rec).usageBaseline;
  return {
    key: key,
    sessionId: rec.sessionId,
    // ⚠ BOTH HANDLES, AND `resumeParked` READS EITHER (`s.sdkSessionId || s.resumeSdkId`). The
    // conversation id is the one thing that makes this a resume rather than a new agent.
    sdkSessionId: sdkId,
    resumeSdkId: sdkId,
    runtimeId: rec.runtimeId || null, // ⚠ NEVER RE-READ LIVE: this conversation belongs to ONE vendor
    channelId: rec.channelId,
    taskId: rec.taskId || '',
    workspaceId: rec.workspaceId,
    side: state.side,
    profile: profile,
    profileLabel: toolProfiles.profileLabel(profile),
    // ⚠ THE LAUNCH STAMPS, RESTORED FROM THE RECORD (2026-09-18, Samuel's ruling). This rebuild
    // and `session-park.js › startResume` are the two sites the persisted fields exist for: they
    // are the only inputs a woken agent has after a restart, and without them an operator's own
    // orchestrator came back capped and denied `launch-depth-capped` by its own button's stamp
    // having been dropped on disk.
    // ⚠ RESTORED, NEVER MINTED, and that distinction is the whole bound. Neither rebuild may write
    // a depth of its own — a lane that could invent `0` would be a SECOND claimant for "a human
    // started this", and there is exactly one (`session-launch-op.js › launchFromButton`).
    // ⚠ STILL FAIL-CLOSED: the record's value is a number or `null` (`session-store.js ›
    // durableSessionRecord`), and `null` — junk, or a record written before the fields existed —
    // reads as the CAP at the gate, which is where `normalizeLaunchDepth` states it.
    launchDepth: rec.launchDepth, launchChain: rec.launchChain === true,
    mode: state.mode,
    counterpartyId: rec.counterpartyId || null, // L1: the task's other party, so the feed stays bound
    bind: rec.bind === 'room' ? 'room' : 'pair', // D2: only a launch that ASKED widens the fence
    agentId: rec.agentId || null, // the @-mention address, the pill's name, the post stamp
    direct: rec.direct === true, // H2: does the server address our unaddressed posts
    counterpartyName: rec.counterpartyName || null,
    model: runtimeCapability.launchModelPick(
      runtimeRegistry.descriptorFor(rec.runtimeId || null), rec.model
    ), // the operator's pick, re-coerced in the stored runtime's own vocabulary
    // The RECORD's word, restored and not re-derived (`session-runtime-truth.js` header); a
    // hand-edited store lands on `'unverified'`. `reparkDormant` still asks the live descriptor.
    usageBaseline: recordedBaseline,
    state: state,
    context: sessionPark.contextFromRecord(rec), // channel/thread/peer names + the identity NAME (F-288)
    nonce: crypto.randomBytes(8).toString('hex'),
    firstTurn: '',
    startedAt: Number(rec.startedAt) || 0,
    // The delta baseline a resumed query is measured from — see the block above for why it is
    // always 0 here. ⚠ `resumeParked` applies the RUNTIME-AWARE rule when it resumes this object,
    // so a `continues` runtime's baseline is decided there rather than assumed here.
    lastTotalTokens: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [],
    // ⚠ NOT a fresh shell: there IS something to resume, so the first woken turn must NOT rebuild
    // the whole v1.9 framing (the SDK resume carries the ROLE block) — `startResume`'s rule.
    freshRun: false,
    freshFraming: false,
    launchGoal: '',
    awaitingDirective: false,
    idleTimer: null,
    settled: false,
    lastInboundSeq: null,
    ownPostIds: new Set(),
    // ⚠ SLACK ON TOP OF THE STORED COUNTER. The record is written at spawn / init / park / settle,
    // so a crash leaves it BELOW ids the server already holds — re-minting one lets the server's
    // idempotency short-circuit answer the old row and silently discard this agent's reply.
    ownPostSeq: store.resumedPostSeq(rec.ownPostSeq),
    operatorUserId: null, // see the docblock: fail-closed, never invented
    query: null,
    abortController: null,
    pushIterator: null,
    windowless: true, // what `session-windowless.js › attachSurface` stamps; every emit no-ops
  };
}

/**
 * THE INTERRUPTED-END ROUTE, for a dormant record that can never be resumed. Identical in shape
 * to `session-engine.js › init`'s scan for a LIVE-when-it-died record, plus the one thing that
 * scan cannot do: a HISTORY ENTRY.
 * ⚠ THE HISTORY ENTRY IS WHAT MAKES THE CARD EXIST. `session-summary.js` reads its ended set from
 * `agent-history.js › listEnded` (bound as `endedRecords`), so a phase flip alone ends the agent
 * with no tombstone — the F-694 symptom by a shorter path. `entries: []` is the honest ring: the
 * narration lived on a session object this process never had.
 */
// `opts.quiet` (2026-09-13 evening): a record parked OUTSIDE the re-park window
// ends with its phase flip and its history entry but NO channel post — on the
// first boot after F-694's window landed there were 65 such records across 12
// channels, and telling every peer that agents parked weeks ago "Ended" would be
// a second burst of noise about nothing that happened today. The card still
// reads Ended; the history still says when it started.
function endInterrupted(key, rec, why, opts) {
  const quiet = !!(opts && opts.quiet);
  store.setRecordPhase(key, 'ended');
  if (!quiet) deps.runLifecycle(
    { channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId, key: key, sdkSessionId: store.getSdkSessionId(key) },
    'task_failed',
    { interrupted: true },
    sessionEffects.terminalBody({ interrupted: true }),
  );
  agentHistory.record({
    key: key,
    agentId: rec.agentId,
    sessionId: rec.sessionId,
    channelId: rec.channelId,
    taskId: rec.taskId,
    workspaceId: rec.workspaceId,
    channelName: rec.channelName,
    threadTitle: rec.taskTitle,
    identityName: rec.identityName, // frozen like the rest of the identity (F-288)
    startedAt: rec.startedAt,
    endedAt: Date.now(),
    // 🔒 `diag: why` STOOD HERE AND IS DELETED (2026-09-13, Samuel's ruling). The card rendered the
    // reason as a red line under a pill that already reads **Ended** — "the app restarted before
    // this agent started a conversation, so there was nothing to resume" — and the ruling is:
    // "We don't need that line to be there … We can just put 'ended.' We don't need to give a
    // reason why." `agent-bits.tsx › AgentEndedPill` is that word, so the card needs nothing here.
    // ⚠ THE FIELD ITSELF IS UNTOUCHED AND SO IS F-692: `mcp-connect-guard.js` and the live ends
    // still write a `diag`, because THEY say something a person cannot otherwise know (an MCP server
    // that never connected). A restart is not that — the operator did it.
    // ⚠ AND `why` IS STILL CARRIED, to the DIAG LOG below and nowhere else. It is how an engineer
    // tells the three end reasons apart in a log; it is not copy. The machine-readable half is the
    // `{ interrupted: true }` extra above, which every renderer keys the calm terminal off.
    diag: null,
    // ⚠ WHICH RUNTIME IT RAN ON, CARRIED (2026-09-21, U10) — and DELIBERATELY WITHOUT AN
    // `endCode`. Samuel's 2026-09-13 ruling above stands: a restart is not a runtime failure and
    // the card says "Ended" and nothing more. `session-detail.js › endReasonFor` answers `null`
    // when BOTH `endCode` and `diag` are absent, so this line adds identity to the row without
    // reviving the reason line that ruling deleted.
    runtimeId: rec.runtimeId || null,
    entries: [],
  });
  diag('session-boot: ended dormant agent —', why, '| agent', String(rec.agentId || ''), 'channel', String(rec.channelId || '').slice(0, 8), 'thread', String(rec.taskId || '').slice(0, 8));
}

/**
 * THE BOOT PASS. Every DORMANT record either comes back Idle or ends visibly; nothing falls
 * through. Called from `session-engine.js › init` in one line, AFTER the interrupted-record scan
 * (disjoint — that one takes `'resume'`, this one `'dormant'`) and BEFORE `store.pruneRecords`,
 * so a re-parked key is in the registry the prune is handed as `keep`.
 * Returns `{ reparked, ended }`.
 *
 * ⚠ **EACH RECORD IS INDEPENDENT, AND SINCE 2026-09-14 THE CODE SAYS SO RATHER THAN THE
 * DOCBLOCK.** This claim stood over a bare loop: ONE throw — a history write that fails, a store
 * handle that is gone, an unbound `deps` — abandoned the pass mid-scan and left every record
 * AFTER it in exactly the third state F-694 exists to forbid, neither re-parked nor ended.
 * `init()`'s own try/catch cannot help, because by the time it catches, the pass is over. A
 * record that throws is counted as NEITHER outcome, so the tally stays honest about what landed,
 * and the diag names the key an engineer has to open.
 */
function reparkDormant() {
  const records = store.loadRecords();
  const keys = Object.keys(records);
  let reparked = 0;
  let ended = 0;
  for (const key of keys) {
    let outcome = '';
    try {
      outcome = reparkOne(key, records[key]);
    } catch (err) {
      // ⚠ THE WHOLE KEY, BOUNDED AT 80 AND NOT AT THE 8 THE OTHER LINES HERE USE. A session key is
      // `<channel uuid>::<agentId>` (or `<channel>:<thread>:<agentId>`), so a short slice keeps the
      // channel and drops the AGENT — the only half that says which card is missing.
      diag('session-boot: a dormant record threw and the pass CONTINUED — key', String(key).slice(0, 80),
        '|', (err && err.message) || String(err));
      continue;
    }
    if (outcome === 'reparked') reparked += 1;
    else if (outcome === 'ended') ended += 1;
  }
  // §3.3: REGISTRATION IS A PROJECTION MOVE — the pill must not wait for a first dispatch. One
  // touch for the whole pass (`touch` coalesces anyway), and the ENDED half needs it too: the
  // retained-ended set is read from the history file at projection time.
  if (reparked || ended) sessionSummary.touch();
  diag('session-boot: dormant records', String(reparked + ended), '→ re-parked', String(reparked), 'ended', String(ended));
  return { reparked: reparked, ended: ended };
}

/**
 * ONE RECORD'S WHOLE DECISION: `'reparked'`, `'ended'`, or `''` for a record this pass does not
 * own. ⚠ A NAMED UNIT RATHER THAN A LOOP BODY, so the per-record try/catch above wraps something
 * with ONE exit vocabulary — three `continue`s that each had to remember to increment a counter
 * is the shape that made "independent" untrue in the first place.
 */
function reparkOne(key, rec) {
  if (!rec || typeof rec !== 'object') return '';
  if (store.reloadDisposition(rec.phase) !== 'dormant') return '';
  // ⚠ ALREADY LIVE IS NOT AN ERROR AND MUST NOT BE OVERWRITTEN. `init()` runs once at app
  // start, but a launch racing it (a deep link, a queued directive) would already own this
  // slot, and replacing the Map entry orphans a live query.
  if (deps.sessions.has(key)) return '';
  // ⚠ THE RECENCY WINDOW, BEFORE ANY RESUMABILITY QUESTION (see its own section above). A
  // record outside it is not resurrected however resumable it looks — it ENDS, visibly, like
  // every other dormant record this pass cannot revive.
  if (!withinReparkWindow(rec, Date.now())) {
    endInterrupted(key, rec, 'this agent was parked longer ago than the re-park window, so the app ended it instead of reviving it', { quiet: true });
    return 'ended';
  }
  const sdkId = store.getSdkSessionId(key);
  // ⚠ NO SDK ID IS THE ORDINARY CASE, NOT A CORRUPTION: a SPAWN-IDLE agent ("New Agent") never
  // started a query, so nothing ever reported a conversation id for it — and the record carries
  // neither its launch goal nor its identity body, so there is nothing to rebuild it from
  // either. An Ended card is the honest answer; a silent disappearance is not.
  // ⚠ THE REASON STRINGS BELOW ARE ENGINEER TEXT AND REACH ONLY THE DIAG LOG (2026-09-13,
  // Samuel: "We don't need that line to be there … We can just put 'ended.'"). The one that used
  // to stand here — "the app restarted before this agent started a conversation, so there was
  // nothing to resume" — was rendered on the card, which is the line he deleted.
  const refusal = sdkId
    ? runtimeCapability.resumeRefusal(runtimeRegistry.descriptorFor(rec.runtimeId))
    : 'no conversation id in the resume map: this agent never started a query'; // LOG ONLY — see endInterrupted
  if (refusal) { endInterrupted(key, rec, refusal); return 'ended'; }
  const s = parkedSessionFromRecord(key, rec, sdkId);
  deps.sessions.set(key, s);
  // ⚠ THE ABANDONMENT BOUND IS ARMED HERE, DELIBERATELY, exactly as the spawn-idle lane arms
  // it: `session-state.js › idleTimeout` reads `parked === true` and answers `abandon_timeout`,
  // so an agent nobody comes back to ENDS on its own instead of holding a slot forever. No
  // reducer event has run on this object, so nothing else would ever arm one.
  deps.scheduleIdle(s);
  diag('session-boot: re-parked dormant agent (Idle; resumes on the next addressed message)', 'agent', String(s.agentId || ''), 'channel', String(s.channelId || '').slice(0, 8), 'thread', String(s.taskId || '').slice(0, 8));
  return 'reparked';
}

// ─── END SESSION-BOOT-PURE ────────────────────────────────────────────────────────

module.exports = {
  bind,
  parkedSessionFromRecord, // exported for the suite; production reaches it through reparkDormant
  endInterrupted,
  reparkDormant,
  REPARK_WINDOW_MS, // the suite pins the boundary against the SHIPPED number, not a copy of it
  withinReparkWindow,
};
