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
// bound is multiplied by `MAX_CONCURRENT_SESSIONS` (`session-windowless.js`, measured 6 on
// 2026-08-27 — this line said "4") — INVARIANTS §11 says so and this is one of them. The ring
// dies with the session object (no persistence, no TTL, no sweep).
// ⚠ THE PER-ENTRY BOUND IS NOT ONE NUMBER, and since 2026-08-27 it is not one ORDER either:
// captions are `TEXT_CAP` (300), a post is `POST_CAP` (1000), and the agent's own PROSE is
// `PROSE_CAP` (2000) — read that constant's note for why the prose had to stop being a caption
// and what the new ceiling costs.
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
// ⚠ AND DO NOT MOVE IT: `channels-v2/agent-stream-model.ts › POST_CAP` is the SAME 1000 and the
// held-draft join is character-for-character against it. Changing one silently breaks every
// pending Post card.
const POST_CAP = 1000;

/**
 * THE AGENT'S OWN PROSE IS A MESSAGE, NOT A CAPTION (Samuel, live review 2026-08-27).
 *
 * ⚠ THE BUG THIS FIXES, and it was invisible from the renderer. `assistant` / `thinking` / the
 * operator's own 1:1 text were all bounded by `TEXT_CAP`, so **the string reaching the SPA was
 * ALREADY 300 chars, mid-word, with no marker**. The work stream's "Show more" raises a DISPLAY
 * clamp (140 → 2000) over a string that had been cut long before it got there, so expanding a
 * long line revealed nothing and left the reader looking at "…or I'll pi". Two truncations, one
 * of them silent — and the silent one was upstream of the control meant to undo it.
 *
 * ⚠ 2000 IS THE UI'S OWN CEILING, DELIBERATELY — `channels-v2/agent-stream-log.tsx ›
 * EXPANDED_CHARS`. Matching it makes the renderer's clip the ONLY truncation an operator can
 * ever meet, and that one SAYS it clipped (INVARIANTS §9). Main is out of the business of
 * cutting text nobody is told about.
 *
 * ⚠ WHY PROSE AND NOT THE CAPTIONS. `TEXT_CAP` still bounds the tool input/result summaries and
 * the status lines, and it must: a tool result is a caption ABOUT a payload, `inputSummary` is
 * already capped at 140 by `session-io.js › summarizeInput`, and `inputFull` — which can carry
 * an entire file — never enters this ring at all (see the header). Widening those is how the
 * ring becomes a file cache.
 *
 * ⚠ WHY PROSE AND NOT THE POST. `POST_CAP` stays 1000 on its own stated argument: a `post` frame
 * is a local ECHO covering the seconds before the transcript loads, and **the transcript is the
 * record** — the UI dedupes the echo against it. The agent's prose has NO second copy anywhere:
 * this ring is the only place it ever exists, which is exactly why a silent cut there destroys
 * the only text there is.
 *
 * ⚠ THE COST, STATED. The ring is `NARRATION_MAX` (200) deep per session, `flush()` sends the
 * WHOLE ring for each dirty session, and the per-session ceiling is multiplied by
 * `session-windowless.js › MAX_CONCURRENT_SESSIONS` (6). So the worst case rises from 200 × 300
 * = 60k chars to 200 × 2000 = 400k chars per session per flush — and that worst case requires
 * every one of 200 entries to be a maximal prose block, which cannot happen on a working agent:
 * tool/result frames are the bulk of any ring and stay at `TEXT_CAP`. The ring is memory-only,
 * dies with the session, and is never persisted. **If this ever needs tightening, tighten
 * `NARRATION_MAX` or send a delta instead of the ring — do not re-introduce a silent cut.**
 */
const PROSE_CAP = 2000;

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
    const text = line(p.text, PROSE_CAP);
    return text ? { at: now, kind: 'assistant', text: text } : null;
  }
  // ⚠ 2026-08-22 — WHAT IT IS THINKING. A reasoning block is model-generated and unbounded by
  // construction, so it IS bounded here — but at `PROSE_CAP` since 2026-08-27, not at the caption
  // cap: the UI's "Show more" is the control for its length, and a 300-char cut upstream made
  // that control a no-op. The UI still collapses it by default.
  if (type === 'thinking') {
    const text = line(p.text, PROSE_CAP);
    return text ? { at: now, kind: 'thinking', text: text } : null;
  }
  // ⚠ THE OPERATOR'S OWN 1:1 MESSAGE (2026-08-22). `rawText` is what they TYPED — the `text` on
  // this event is the FRAMED prompt (`session-seed.js › frameOperatorTurn`), which is an
  // instruction to a model and not a caption for a human. Only the 1:1 lane sets `private`, so
  // an ordinary steer still produces nothing.
  // ⚠ `PROSE_CAP` here too: what the operator TYPED is a message, and it is the only copy of it
  // — the 1:1 lane posts nothing to the channel, so nothing else holds these words.
  if (type === 'steer' && event && event.private === true) {
    const text = line(event.rawText, PROSE_CAP);
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
