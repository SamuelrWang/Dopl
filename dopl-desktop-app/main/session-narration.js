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
// bound is multiplied by `MAX_CONCURRENT_SESSIONS` (`session-windowless.js`, 15 since
// 2026-09-01; 6 before that, and this line said "4" until 2026-08-27) — INVARIANTS §11 says so
// and this is one of them. ⚠ The 2026-09-01 raise is safe for THIS ring only because
// `RING_CHAR_BUDGET` bounds it by characters as well as entries. The ring
// dies with the session object (no persistence, no TTL, no sweep).
// ⚠ AND IT IS MULTIPLIED AGAIN BY THE WINDOW COUNT, which this header did not say until
// 2026-08-30 and which is what made the 17 GB dev incident: `flush()` sends the WHOLE ring and
// `sendToWindows` clones it into EVERY live window's message pipe (up to nine), five times a
// second, in NATIVE memory no heap snapshot shows. **A per-session bound stated without the
// fan-out and the rate is not a bound on anything that matters.** `RING_CHAR_BUDGET` is the
// second bound and carries the whole story.
// ⚠ THE PER-ENTRY BOUND IS NOT ONE NUMBER, and since 2026-08-27 it is not one ORDER either:
// captions are `TEXT_CAP` (300), a post is `POST_CAP` (1000), and the agent's own PROSE is
// `PROSE_CAP` — read `main/narration-text.js` for all four, for why the prose had to stop being a
// caption, and for the CAPTION-vs-PROSE rule that decides which shaper a frame gets.
// ⚠ THIS LINE SAID `PROSE_CAP` (2000) UNTIL 2026-08-31 AND THE CONSTANT WAS 8000 BY THEN — the
// shape a number copied into a second file always ends up in. It is not restated here again.
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
// 2026-08-31: WHOSE question this turn answers — the operator's own, or another of their
// agents'. Attribution only; it reaches no gate.
const { isDirectedTurn } = require('./session-directed');
// F-376a (2026-08-31): the agent-id charset, so the sender CAPTION on a directed entry is
// shape-gated against the ONE grammar rather than a second copy of it.
const { AGENT_ID_RE } = require('./agent-id');
const { diag } = require('./diag');
// ⚠ THE FOUR CAPS AND THE TWO SHAPERS MOVED TO `main/narration-text.js` ON 2026-08-31 (§2 split,
// under the §1 cap). Read that file's header before touching a bound: it carries the CAPTION vs
// PROSE rule, why `line` flattens and `prose` must not, and the "bounded by CHARACTERS, never by
// SHAPE" rule F-376b was filed for. ⚠ ABOVE THE SENTINEL, like `appWindows` and `isPrivateTurn`:
// everything below it is a free var, and a `require` inside the block would break the extraction
// idiom the marker promises. Re-exported at the foot, so no caller and no test moved.
const { TEXT_CAP, TOOL_CAP, POST_CAP, PROSE_CAP, line, prose } = require('./narration-text');

// ─── BEGIN SESSION-NARRATION-PURE (injectable; unit-tested via source extraction) ─────
// `appWindows` and `diag` are free vars from here down.

const NARRATION_EVENT = 'dopl:session-narration';

// The per-session ring. See the header for the arithmetic; 200 is roughly an hour of a
// busy agent and comfortably more than a human scrolls back through.
const NARRATION_MAX = 200;

/**
 * THE RING'S SECOND BOUND — CHARACTERS, NOT ENTRIES (2026-08-30, the 17 GB dev incident).
 *
 * ⚠ THE BUG. `flush()` sends the WHOLE ring for each dirty session, `sendToWindows` fans that
 * payload out to EVERY live window, and `note()` marks a session dirty on EVERY SDK event — so
 * the feed re-serializes the entire ring at up to `1000 / PUSH_COALESCE_MS` = 5 Hz, per session,
 * per window. `webContents.send` STRUCTURE-CLONES its payload into a Mojo message pipe, which is
 * NATIVE memory: it exerts no GC pressure, it shows up in RSS and not in a heap snapshot, and a
 * renderer that is slow to drain (a dev renderer under HMR, one mid-refetch-storm, one with
 * DevTools attached) queues it with no backpressure whatsoever.
 *
 * ⚠ WHAT MADE IT AN INCIDENT RATHER THAN A COST. `PROSE_CAP` rose 300 → 2000 on 2026-08-27, and
 * that constant's own note does the arithmetic — "the worst case rises from 200 × 300 = 60k to
 * 200 × 2000 = 400k chars per session per flush". What the note leaves out is the FAN-OUT: the
 * payload is cloned once per live window, and there can be nine (the SPA plus
 * `popout-window.js › MAX_POPOUTS` plus `agent-window.js › MAX_AGENT_WINDOWS`). 400k × 6
 * sessions × 9 windows × 5 Hz is a rate, not a size, and nothing in this file bounded a rate.
 * That note ALSO named the two acceptable fixes — "tighten `NARRATION_MAX` or send a delta
 * instead of the ring" — and this is the first of them, generalized.
 *
 * ⚠ 60_000 IS EXACTLY THE PRE-2026-08-27 CEILING (200 × `TEXT_CAP`), and that is the whole
 * argument for the number. It restores the byte ceiling the feed was designed around WITHOUT
 * undoing `PROSE_CAP`: a long line still arrives WHOLE, never cut mid-word, never cut silently
 * — it simply costs more of the ring, so what pays is the OLDEST ENTRIES, which is what a ring
 * is for. **Do not "fix" a future over-run by lowering `PROSE_CAP`. That reintroduces the silent
 * cut Samuel's 2026-08-27 ruling deleted; lower this, or send a delta.**
 *
 * Pinned by test/session-narration.test.mjs (regression: 17 GB dev RSS, 2026-08-30).
 */
const RING_CHAR_BUDGET = 60_000;

/** Per-entry overhead beyond `text` — `at` / `kind` / `lane` / `toolUseId` / `tool` / `ok` /
 *  `pending` and their JSON punctuation. Approximate ON PURPOSE: the budget is a ceiling on a
 *  wire payload, not an accounting record, and a fixed charge per entry is what stops 200
 *  empty-text frames from being free. */
const ENTRY_OVERHEAD_CHARS = 64;

function entryChars(entry) {
  const text = entry && typeof entry.text === 'string' ? entry.text.length : 0;
  return text + ENTRY_OVERHEAD_CHARS;
}

// One burst of engine dispatches must cost ONE render, exactly as the summaries feed
// decided. Deliberately the SAME 200ms: two feeds landing on one surface at different
// cadences make the panel judder for no benefit.
const PUSH_COALESCE_MS = 200;

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
 *   post            the agent SENT a message into the channel or thread — or is WAITING to
 *                   (`pending: true`, 2026-08-25): the outbound consent gate is holding it.
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
  // ⚠ `PROSE_CAP`, NOT `TEXT_CAP` (2026-08-27) — this is the agent SPEAKING, and the ring is the
  // only copy of it that exists anywhere. See PROSE_CAP's note for the whole argument.
  if (type === 'assistant') {
    const { text, truncated } = prose(p.text);
    if (!text) return null;
    const entry = { at: now, kind: 'assistant', text: text };
    if (truncated) entry.truncated = true;
    return entry;
  }
  // ⚠ 2026-08-22 — WHAT IT IS THINKING. A reasoning block is model-generated and unbounded by
  // construction, so it IS bounded here — but at `PROSE_CAP` since 2026-08-27, not at the caption
  // cap: the UI's "Show more" is the control for its length, and a 300-char cut upstream made
  // that control a no-op. The UI still collapses it by default.
  if (type === 'thinking') {
    const { text, truncated } = prose(p.text);
    if (!text) return null;
    const entry = { at: now, kind: 'thinking', text: text };
    if (truncated) entry.truncated = true;
    return entry;
  }
  // ⚠ THE OPERATOR'S OWN 1:1 MESSAGE (2026-08-22). `rawText` is what they TYPED — the `text` on
  // this event is the FRAMED prompt (`session-seed.js › frameOperatorTurn`), which is an
  // instruction to a model and not a caption for a human. Only the 1:1 lane sets `private`, so
  // an ordinary steer still produces nothing.
  // ⚠ `PROSE_CAP` here too: what the operator TYPED is a message, and it is the only copy of it
  // — the 1:1 lane posts nothing to the channel, so nothing else holds these words.
  if (type === 'steer' && event && event.private === true) {
    const { text, truncated } = prose(event.rawText);
    if (!text) return null;
    // ⚠ WHO SPOKE (2026-08-31). A DIRECTION arrives on the same `steer`, through the same
    // private lane, and is NOT the operator — it is another of their agents, running under
    // their credential, over MCP. Rendering it as an operator turn would put words in the
    // operator's mouth on their own screen, wearing their avatar: the impersonation problem
    // `session-seed.js › frameDirectedTurn` solves for the MODEL, solved here for the HUMAN.
    // ⚠ ITS OWN `lane`, because a lane is what a reader is required to prefer: a kind rename
    // can never turn this back into a line that looks like something the operator typed.
    // ⚠ …AND SINCE 2026-08-31, **WHICH OF THEM** (F-376a). Samuel's same-owner ruling makes the
    // operator's own desktop sessions first-class `direct_agent` callers, so a room can hold six
    // of their agents directing each other and "your agent said this" stops being a complete
    // sentence. ⚠ **A CAPTION, AND AN UNVERIFIED ONE** — the id is server-derived from
    // `X-Dopl-Session-Id`, which proves nothing about the caller, so nothing on either side of
    // this frame may gate, route or attribute AUTHORITY on it. ⚠ OMITTED WHEN ABSENT rather than
    // written as null, the `truncated` / `pending` discipline: an EXTERNAL orchestrator has no
    // session stamp and no agent id, and the reader's fallback for that is the sentence it
    // already showed ("your agent").
    const entry = event.directed === true
      ? { at: now, kind: 'directed', lane: 'directed', text: text }
      : { at: now, kind: 'operator', lane: 'operator', text: text };
    if (event.directed === true && AGENT_ID_RE.test(String(event.senderAgentId || ''))) {
      entry.senderAgentId = String(event.senderAgentId);
    }
    if (truncated) entry.truncated = true;
    return entry;
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
    // MAX_CONCURRENT_SESSIONS — 200 posts x 2000 chars x 15 sessions is several megabytes of
    // IPC per flush (it was 6 sessions until 2026-09-01), which is what `RING_CHAR_BUDGET`
    // exists to bound. The TRANSCRIPT is the record and the UI dedupes this against it, so the echo only
    // has to be good enough to read while it arrives.
    const entry = { at: now, kind: 'post', lane: 'channel', text: line(p.text, POST_CAP) };
    // ⚠ THE GATE RIDES THE FRAME (2026-08-25, Samuel's outbound-review ruling). `session-io.js ›
    // sdkRenderEvents` stamps `pending` on this payload when `willGatePost` says the post will be
    // held for the operator's Send, and this lane USED TO DROP IT — so the work stream painted a
    // "Posted to channel" box the moment the agent CALLED the tool, for a message that had not
    // left the machine and might never. The card is the review surface now, and it cannot say
    // PENDING over a frame that does not carry the fact.
    // ⚠ ONLY AN EXPLICIT `true` COUNTS, matching every other read of this flag on this path
    // (`session-io.js`'s own comment: the renderer is fail-SUSPICIOUS). Absent means "not gated",
    // which is the shape every existing build emits and must keep rendering as a plain post.
    if (p.pending === true) entry.pending = true;
    return entry;
  }
  // A status line is worth a narration entry only when it says something a WATCHER would
  // want: the pill already carries the live state, so this is for the transitions that
  // explain a silence (parked, ended, blocked on a gate).
  if (type === 'idle_timeout') return { at: now, kind: 'status', text: 'Paused — idle' };
  if (type === 'interrupt') return { at: now, kind: 'status', text: 'Paused by you' };
  if (type === 'end') return { at: now, kind: 'status', text: 'Ended by you' };
  if (type === 'inactive') return { at: now, kind: 'status', text: 'Ended — inactive' };
  if (type === 'permission_request') {
    // ⚠ AN OUTBOUND POST GATE GETS NO LINE OF ITS OWN (2026-08-25). The gate that holds a
    // channel post raises `payload.type === 'outbound_gate'` (`session-io.js`), and the `post`
    // frame beside it ALREADY carries `pending: true` — the work stream's card is the review
    // surface now (INVARIANTS §6), and it says "Pending" in the operator's own words. A second
    // line saying "Waiting for permission" was a duplicate on the way in and, because this ring
    // is APPEND-ONLY and never revisited, a LIE on the way out: it sat under a delivered post
    // forever. Samuel saw exactly that. Fewer frames is the fix; a "no longer waiting" frame
    // would be one more thing to keep in step with the card.
    // ⚠ THE DOCK'S TOOL GATE STILL SPEAKS. It has no card, so this line is the only thing that
    // explains that silence — which is what a `status` entry is for.
    // ⚠ A HELD POST rides its own `outbound_post` frame (pending:true), so its gate needs no line.
    // A held own-channel CREATE_THREAD does NOT — it renders as a plain `tool_use` frame with no
    // `pending`, so without this the operator sees a `dopl_channel` row then silence to the 24h TTL
    // (F-321). Mint the SAME pending sent-lane frame a post carries: `session-io.js` stamps
    // `threadOpen` on exactly the create_thread gate, and `text` is `input.body` on both arms, so
    // the SPA card reconciles this against the consent row `bridgeOutbound` built from that body.
    if (p.type === 'outbound_gate') {
      if (p.threadOpen === true) {
        return { at: now, kind: 'post', lane: 'channel', text: line(p.text, POST_CAP), pending: true };
      }
      return null;
    }
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

/**
 * THE ANSWER TO A DIRECTION, TAGGED AS ONE (2026-08-31).
 *
 * ⚠ APPLIED AFTER {@link retagPrivate} AND ONLY OVER ITS OUTPUT, so there is exactly one
 * place an `assistant` line becomes private and this narrows that result rather than
 * competing with it. A directed turn IS a private turn; what this adds is WHOSE question it
 * answers, which is the half the operator cannot otherwise see.
 * ⚠ ONLY `private` MOVES — the same rule `retagPrivate` follows for `assistant`. A `post`
 * inside a directed turn keeps `lane: 'channel'`, because it is the one thing that did not
 * stay private.
 */
function retagDirected(entry, isDirected) {
  if (!entry || !isDirected || entry.kind !== 'private') return entry;
  return { ...entry, kind: 'directed-reply', lane: 'directed' };
}

/**
 * Append to a session's ring, dropping the oldest past EITHER bound. Returns the ring.
 *
 * ⚠ TWO BOUNDS, AND THE SECOND IS THE ONE THAT MATTERS FOR MEMORY. `NARRATION_MAX` bounds how
 * far back a watcher can scroll; `RING_CHAR_BUDGET` bounds what `flush()` re-serializes to every
 * window five times a second. See `RING_CHAR_BUDGET`'s note.
 * ⚠ THE LAST ENTRY IS NEVER DROPPED, even alone over budget: a single maximal `PROSE_CAP` line
 * must still reach the window it was widened for. The budget bounds a BACKLOG, never the present.
 */
function push(s, entry) {
  if (!s.narration) s.narration = [];
  s.narration.push(entry);
  if (s.narration.length > NARRATION_MAX) {
    s.narration = s.narration.slice(s.narration.length - NARRATION_MAX);
  }
  let chars = 0;
  for (const e of s.narration) chars += entryChars(e);
  let drop = 0;
  while (drop < s.narration.length - 1 && chars > RING_CHAR_BUDGET) {
    chars -= entryChars(s.narration[drop]);
    drop += 1;
  }
  if (drop > 0) s.narration = s.narration.slice(drop);
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
  const entry = retagDirected(
    retagPrivate(entryFor(event, Date.now()), isPrivateTurn(s)),
    isDirectedTurn(s)
  );
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
  TEXT_CAP, // exported so the char-budget pin DERIVES its number instead of restating it
  RING_CHAR_BUDGET,
  ENTRY_OVERHEAD_CHARS,
  PUSH_COALESCE_MS,
  entryFor,
  PROSE_CAP,
  retagPrivate, // 2026-08-22: an `assistant` line inside a private turn is the agent's PRIVATE side
  POST_CAP,
  push,
  // the live half
  bind,
  start,
  note,
  ringFor,
};
