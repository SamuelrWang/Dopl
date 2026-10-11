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
// It can carry an entire file's contents, and this feed crosses to a renderer that logs nothing and stores nothing.
//
// ⚠ IT IS A VIEW OF A RUN, NOT A RECORD OF ONE. A window opened after the fact sees the
// last 200 entries and no more; the channel transcript is what persists. That is the same
// retention argument `session-summary.js` makes for an ended pill.
//
// ⚠ IT IS FIVE FILES, AND THE SEAM IS THE SUBJECT. THIS file holds the EVENT -> ENTRY mapping (`entryFor`, `retagPrivate`) and the three
// append entry points. `session-narration-shape.js` (2026-10-11) holds the per-entry shapers;
// `session-narration-fanout.js` (2026-10-11) holds the dirty set, the ONE coalescing timer and
// the window fan-out, so `flush()` and `sendToWindows` as named above are ITS functions;
// `narration-text.js` holds the four caps and `narration-ring.js` the ring's two bounds. Every
// name is re-exported here unchanged, so no caller and no test moved.

// A9 (2026-09-06): the operator-facing copy for an ended session. ⚠ REQUIRED ABOVE THE SENTINEL
// like every other require in this file, and used only in the append half below it — the pure
// block must stay free of `require`, and `endedStatusText` is not called from inside it.
// session-effects.js is pure and requires nothing back, so this cannot cycle.
const sessionEffects = require('./session-effects');
// 2026-08-22: is the turn this entry belongs to a PRIVATE (1:1) one? `session-private.js` owns
// the window; this lane only asks. Required above the sentinel like every other one here, so it
// is a free var the source-extraction test injects.
const { isPrivateTurn } = require('./session-private');
// 2026-08-31: WHOSE question this turn answers — the operator's own, or another of their
// agents'. Attribution only; it reaches no gate.
const { isDirectedTurn } = require('./session-directed');
// F-376a (2026-08-31): the agent-id charset, so the sender CAPTION on a directed entry is
// shape-gated against the ONE grammar rather than a second copy of it.
const { AGENT_ID_RE } = require('./agent-id');
// ⚠ THE FOUR CAPS AND THE TWO SHAPERS MOVED TO `main/narration-text.js` ON 2026-08-31 (§2 split,
// under the §1 cap). Read that file's header before touching a bound: it carries the CAPTION vs
// PROSE rule, why `line` flattens and `prose` must not, and the "bounded by CHARACTERS, never by
// SHAPE" rule F-376b was filed for. ⚠ ABOVE THE SENTINEL, like every other require here:
// everything below it is a free var, and a `require` inside the block would break the extraction
// idiom the marker promises. Re-exported at the foot, so no caller and no test moved.
const { TEXT_CAP, TOOL_CAP, POST_CAP, PROSE_CAP, line, prose } = require('./narration-text');
// ⚠ THE RING’S TWO BOUNDS AND ITS APPEND LIVE IN `narration-ring.js` (§2 SPLIT, 2026-09-14):
// `NARRATION_MAX`, `RING_CHAR_BUDGET` (with the 17 GB incident it was bought by),
// `ENTRY_OVERHEAD_CHARS`, `entryChars` and `push`. Read that file before touching a bound.
// ⚠ ABOVE THE SENTINEL like every other require here, so the block below keeps its extraction
// promise and the four names stay free vars in it. Re-exported at the foot, unchanged.
const { NARRATION_MAX, RING_CHAR_BUDGET, ENTRY_OVERHEAD_CHARS, entryChars, push } = require('./narration-ring');
// ⚠ THE PER-ENTRY SHAPERS MOVED TO `main/session-narration-shape.js` (§2 SPLIT, 2026-10-11):
// `SENDER_CAP`, `inboundBody`, `stampToolRun` and `retagDirected`. Each is pure over ONE entry or
// one string; what stays here is the event -> entry MAPPING (`entryFor`) and the privacy re-tag
// beside it, which is a different question. Read that file before touching a cap or the ordinal.
// ⚠ ABOVE THE SENTINEL like every other require here, so the four stay free vars in the block
// below. `stampToolRun` is re-exported at the foot, unchanged, so no caller and no test moved.
const { SENDER_CAP, inboundBody, stampToolRun, retagDirected } = require('./session-narration-shape');
// ⚠ THE LIVE HALF MOVED TO `main/session-narration-fanout.js` (§2 SPLIT, 2026-10-11): the dirty
// set, the one coalescing timer, `PUSH_COALESCE_MS`, `NARRATION_EVENT`, the window-registry
// fan-out, `ringFor` and the engine's `bind`. Read that file's header before touching the cadence.
// ⚠ **THE MUTABLE STATE WENT WITH IT AND THERE IS EXACTLY ONE OF EACH.** This file keeps no dirty
// Map and no timer: the three `note*` entry points below call `fanout.touch(key)`, which marks and
// arms inside the module that owns both. A copy here would mark keys the flush never reads, and a
// second timer would double-fire a push whose rate is what `RING_CHAR_BUDGET` bounds.
// ⚠ **AND THE DEPENDENCY POINTS ONE WAY.** This module replaces `module.exports` wholesale, so a
// partner that required it back would capture `{}` at load and throw on the first append; the
// fan-out requires only `app-windows` and `diag`, and neither sibling reaches back here at all.
const fanout = require('./session-narration-fanout');
const { NARRATION_EVENT, PUSH_COALESCE_MS, bind, start, ringFor } = fanout;

// ─── BEGIN SESSION-NARRATION-PURE (injectable; unit-tested via source extraction) ─────
// Everything required above is a free var from here down.

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
 *   inbound         a channel message ARRIVED for this agent and woke it (2026-10-10, #3081) —
 *                   the counterparty's own words, with `senderName` beside them.
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
 *   'inbound'   it ARRIVED from the channel — the counterparty wrote it and both members have it.
 *               ⚠ Deliberately NOT `'channel'`: that lane is drawn as the dark "Posted to…" box,
 *               so reusing it would render somebody else's message as something this agent said.
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
  // ⚠ **WHAT WOKE IT** (2026-10-10, Samuel #3081: the stream showed the agent working and the boxes
  // it posted, and nothing about the message it was answering). A channel post addressed to this
  // agent — an `@agent-<id>` tag, a `to=`, or a reply in the thread it is working — arrives as
  // `inbound_arrived` through `session-gate.js › enqueue`, reaches this funnel like every other
  // event, and produced NOTHING: there was no arm for it, so `note()` appended nothing and the one
  // half of the exchange the operator cannot reconstruct was the half that was missing.
  //
  // ⚠ **`event.message` IS THE RAW BODY, WHICH IS WHY NO FENCE IS STRIPPED HERE.** The security
  // wrapper (`session-seed.js › frameContinuation`'s `BEGIN-REQUEST-<nonce>` block, its addressing
  // lines and its "Answer IN THE CHANNEL" instruction) is built LATER, in the `pushInbound` effect,
  // over this same string — so the frame sees the peer's words before any of it exists. A reader
  // that stripped markers out of the framed prompt instead would be parsing an instruction to a
  // model and showing the leftovers to a human.
  //
  // ⚠ **IT IS ITS OWN `lane`, AND IT MAY NOT BE `'channel'`.** A lane states AUDIENCE and the reader
  // is required to prefer it (see the `lane` note above), but `'channel'` already means ONE thing on
  // this surface — *these words LEFT the machine* — and the renderer paints it as the dark "Posted
  // to…" box. An arriving message wearing that lane would be drawn as something this agent SAID,
  // which is the exact class of lie the lane vocabulary exists to make impossible. `'inbound'` is
  // the symmetric fact: it is in the channel, and the counterparty is the one who wrote it.
  //
  // ⚠ **THE BODY IS PROSE, BOUNDED AT `POST_CAP` RATHER THAN `PROSE_CAP`** — both halves deliberate.
  // PROSE because this is a MESSAGE and its structure is its content (`narration-text.js`'s
  // CAPTION-vs-PROSE rule: `line` would flatten a peer's numbered task list into one paragraph and
  // delete the meaning of everything that arrived). `POST_CAP` because the **channel transcript is
  // the record**, exactly as the `outbound_post` arm argues for its own echo: the full message is on
  // the server and in the message pane, so this frame only has to be worth reading in place. At
  // `PROSE_CAP` one 8000-char peer message would spend an eighth of `RING_CHAR_BUDGET` and evict the
  // agent's own work frames to show words that are already two panes away.
  // ⚠ AND THE CUT SAYS SO (INVARIANTS §9) — {@link inboundBody} ORs both caps' truncation.
  //
  // ⚠ **THE SENDER IS A CAPTION AND AN UNVERIFIED ONE**, on `senderAgentId`'s precedent. It is
  // `session-dispatch.js › authorLabel`'s already-resolved label (a display name, *"<person>'s
  // agent"*, or its own `'A teammate'` fallback) — peer-typed prose that nothing here may gate,
  // route or attribute authority on, and the renderer neutralizes it as a text child.
  // ⚠ OMITTED WHEN ABSENT rather than written as null, the `truncated` / `pending` discipline: the
  // reader's fallback is the anonymous sentence, never a blank and never an id.
  if (type === 'inbound_arrived') {
    const { text, truncated } = inboundBody(event && event.message);
    if (!text) return null;
    const entry = { at: now, kind: 'inbound', lane: 'inbound', text: text };
    const who = line(event && event.authorName, SENDER_CAP);
    if (who) entry.senderName = who;
    // ⚠ WHOSE SIDE IT CAME FROM, so the face can say "you" where it is the operator's own channel
    // post. It is NOT a privacy claim: this message is in the channel either way, which is what
    // keeps it off the `lane`.
    if (event && event.fromOperator === true) entry.fromOperator = true;
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
  // ⚠ THE TWO `end` ARMS MOVED TO {@link noteEnded} (2026-09-06, A9) — they are not deleted, and
  // this is not a widening. They keyed off the ACTION type, which can only ever see two of the
  // five ways a session ends: a turn or cost cap is reached INSIDE a `result` action and an
  // abandonment is a timer, so those three ended in silence no matter what this switch said. The
  // `ended` EMIT carries the reason for all five, so the line is minted from that instead and
  // there is exactly one table (`session-effects.js › endedStatusText`) for it. Re-adding an arm
  // here would put a second line under the same ending.
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
    // ⚠ **AND EVERY OUTBOUND GATE IS A HELD POST NOW (2026-09-02, B8).** This arm minted the
    // pending sent-lane frame for a held `create_thread`, which was NOT a post and rendered as a
    // plain `tool_use` with no `pending` — so the operator saw a `dopl_channel` row and then
    // silence to the 24h TTL (F-321). A thread open is `send(thread="new")` and an escalation is
    // `send(kind="decision")`, so `renderEvents` emits the frame for both, and a second one minted
    // here would be the duplicate this comment's first paragraph is about. The `threadOpen` flag
    // is deleted at its source (`session-gate-bridge.js › gatePayload`).
    if (p.type === 'outbound_gate') return null;
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

// ─── END SESSION-NARRATION-PURE ──────────────────────────────────────────────────────

// ── The append half: one event -> one ring entry, then `fanout.touch` ────────────────

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
  // The run ordinal is stamped at the APPEND, because the ring evicts and a count derived from what
  // survived is not a count ({@link stampToolRun}).
  push(s, stampToolRun(s, entry));
  fanout.touch(s.key);
}

/**
 * A session ENDED. Say why, in the operator's own window (2026-09-06, A9; filed at #1209).
 *
 * ⚠ FED THE `ended` EMIT, NOT A DISPATCH ACTION, which is the whole reason it is a second entry
 * point rather than another arm of `entryFor`. Two of the five ends have no action type to key
 * off: a turn or cost cap is reached inside a `result` (`session-reducer.js` :239/:242). The emit
 * is the one place every end already knows its own reason.
 *
 * ⚠ IT RUNS BEFORE `settle`, AND THE EFFECT ORDER IS WHAT GUARANTEES IT. `endEffects` returns
 * `[abortQuery, lifecycle, emit, settle]`, so the engine pushes this line while the session
 * object is still live and `settle` then freezes the ring into the 7-day history
 * (`agent-history.js`). A line appended after the settle would be written to a ring nobody reads
 * again. `session-inactive-notice.test.mjs` already pins that order for its own reason.
 *
 * ⚠ THE FLUSH IS ASYNC AND THAT IS FINE. `schedule()` coalesces, so the window may well be gone
 * before the frame goes out — the ENTRY is what matters, because `narrationFor` serves an ended
 * agent's window out of the frozen history rather than out of a live ring.
 */
function noteEnded(s, payload) {
  if (!s || !s.key || !payload) return;
  const text = sessionEffects.endedStatusText(payload.reason, s.state);
  if (!text) return; // a reason-less end says nothing rather than inventing a cause
  // Through the same stamp as every other append: a `status` frame ENDS a tool run (it is not in the tool
  // lane), and the reset belongs at the one place the run counter is touched.
  push(s, stampToolRun(s, { at: Date.now(), kind: 'status', text: text }));
  fanout.touch(s.key);
}

/**
 * THE MESSAGE THAT **LAUNCHED** THIS SESSION, as the same inbound frame (2026-10-10, #3081).
 *
 * ⚠ **IT IS A SECOND ENTRY POINT FOR THE SAME REASON {@link noteEnded} IS ONE: there is no event.**
 * A trigger message does not arrive as `inbound_arrived` — `trigger.js › handleTrigger` passes it to
 * `session-launch.js › launchResponderSession` as the launch's `firstMessage`, and
 * `session-engine.js › firstTurnFor` frames it straight into the session's FIRST QUERY TURN. No
 * reducer event is ever dispatched for it, so `entryFor` cannot see it however many arms it grows.
 * ⚠ **AND IT IS THE CASE THAT MATTERS MOST.** #3081 is about an agent whose stream opens with it
 * already thinking; the message it was woken to answer is the first thing that happened to it and
 * was the one thing not on screen. Covering only the follow-ups would leave every freshly woken
 * agent — the common one — exactly as it was.
 *
 * ⚠ **THE WAKE TURN OF A PARKED SHELL IS NOT THIS PATH AND MUST NOT BE SENT HERE.** A spawn-idle
 * session pushes nothing at launch (`firstTurnFor` returns `''`); its goal rides `launchGoal` to the
 * wake turn, and that wake IS an `inbound_arrived` dispatch — so it already has a frame, and a
 * second one minted here would double it. The caller gates on `parkedShell`.
 * ⚠ **AND NEITHER IS A REQUESTER LAUNCH.** `side: 'requester'` carries the OPERATOR's own goal
 * (`launchRequesterSession`'s `a.goal`), which nobody sent to anybody: labelling it as a message
 * that arrived from a counterparty would be this lane inventing a sender. The caller gates on side.
 *
 * ⚠ IT RUNS THROUGH {@link stampToolRun} LIKE EVERY OTHER APPEND, so the run counter is touched in
 * exactly one place. The reset is a no-op here by construction (nothing has run yet), and that is
 * the point: the ordinal stays `session-narration`'s single rule rather than acquiring an exception.
 */
function noteLaunchMessage(s, a) {
  if (!s || !s.key || !a) return;
  const entry = entryFor({ type: 'inbound_arrived', message: a.message, authorName: a.authorName }, Date.now());
  if (!entry) return;
  push(s, stampToolRun(s, entry));
  fanout.touch(s.key);
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
  stampToolRun, // 2026-10-10: the run's tool-use ordinal, stamped where nothing is evicted
  POST_CAP,
  push,
  // the live half (`bind` / `start` / `ringFor` are the fan-out's own objects, re-exported)
  bind,
  start,
  note,
  noteEnded, // A9: minted from the `ended` EMIT, which is the only thing that knows why
  noteLaunchMessage, // #3081: the trigger message, which arrives as a launch arg and never as an event
  ringFor,
};
