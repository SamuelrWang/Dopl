// THE DIRECTED TURN — a turn opened by an MCP DIRECTION rather than by the operator's own
// keyboard (Samuel's ruling, 2026-08-31).
//
// ⚠ **IT IS DELIBERATELY NOT PART OF `session-private.js`, AND THE SPLIT IS THE SECURITY
// STATEMENT.** That file is the GATE: it withdraws AXIS B's outbound widening so an accidental
// public reply is impossible. A direction opens exactly that gate, through exactly that
// function, unchanged — this module adds NOTHING to the gate and could not weaken it if it
// tried. What it owns is two things the gate does not care about:
//
//   1. **ATTRIBUTION.** The operator must be able to tell words their own other AGENT sent
//      from words they typed themselves. Without this the direction renders in the panel as
//      an operator turn, wearing their avatar — the private lane's own impersonation problem,
//      one layer up from the framing ruling that solves it for the model.
//   2. **THE REPLY CAPTURE.** The direction's answer has to go back to the mailbox, and the
//      answer is the FINAL TEXT OF ONE TURN and nothing else.
//
// 🔒 **THE CAPTURE RULE, WHICH IS THE WHOLE JUSTIFICATION FOR THE `reply` COLUMN EXISTING:**
// a direction that arrived from off-machine gets an answer that goes back off-machine, and
// NOTHING ELSE IN THE PRIVATE LANE EVER DOES. Not the narration ring. Not `thinking` frames.
// Not tool calls or their arguments. Not any other turn. And never anything the OPERATOR typed
// into their own composer — an operator's private message opens a private turn through the
// same door and must leave no trace here, which is why the capture is armed only by the
// direction lane and is keyed to one direction id.
//
// ⚠ **A TORN-DOWN QUERY REPORTS NOTHING.** `session-private.js › resetPrivateTurn` exists
// because a superseded query owes no `result` events; the same is true of the capture, and the
// consequence here is stronger — a capture left armed across a park would attach the NEXT
// turn's text to a direction that never got one. The row lazy-expires instead, which is the
// honest terminal state for an outcome nobody observed.

// ─── BEGIN SESSION-DIRECTED-PURE (pure; unit-tested via source extraction) ────────

// ⚠ THE SAME BOUND THE COLUMN CHECK AND THE ROUTE SCHEMA CARRY. Three statements of one
// number, and this is the one that runs first — a reply over the cap is TRUNCATED here rather
// than 400ing the decide, because losing the tail of an answer is better than losing the whole
// answer plus the terminal write that tells the orchestrator anything happened at all.
const REPLY_CAP = 8000;

// ⚠ CHARSET-STRIPPED ON THE SAME TERMS AS `detail` / `toolLabel` / `model`
// (`session-telemetry.js › UNSAFE_LABEL_RE`): zod validates the WHOLE decide body, so one
// control character in a model's output would 400 the write unretryably and the direction
// would expire as if the turn had never run.
// ⚠ **NEWLINE AND TAB SURVIVE, WHICH IS WHERE THIS DIFFERS FROM THE LABEL RULE, AND IT IS
// THE SAME DISTINCTION `safe-label.ts` DRAWS BETWEEN A LABEL AND PROSE.** A reply is a BODY —
// rendered as itself to a human — not a value spliced into a line we wrote. Stripping its
// line breaks would mangle every multi-paragraph answer this feature exists to carry.
// ⚠ WRITTEN AS ESCAPES AND NEVER AS THE LITERALS: a control character pasted into source
// is invisible in review and, inside a character class, is a syntax error waiting for the
// next editor to normalize it.
const UNSAFE_REPLY_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

/** Bound + strip one reply. ⚠ Answers `''` for anything unusable, and the CALLER decides what
 *  `''` means — the wire's `null` is "not reported", never "the agent said nothing". */
function safeReply(text) {
  if (typeof text !== 'string') return '';
  return text.replace(UNSAFE_REPLY_RE, '').slice(0, REPLY_CAP);
}

/**
 * THE DIRECTION ON A `messageByTask` CALL, VALIDATED — or `false` for one that is malformed.
 *
 * Three answers, and the third is the point:
 *   • `null`  — no direction. The operator's own keyboard, which is every pre-existing caller.
 *   • object  — a direction, with an agent named.
 *   • `false` — a DIRECTION THAT NAMES NO AGENT, which the caller must refuse.
 *
 * 🔒 **WHY A DIRECTION MUST NAME ITS AGENT AND HAS NO FALLBACK.** `session-reopen.js ›
 * resolveSession` takes the OLDEST live agent on a thread when none is named — correct for the
 * OPERATOR, who is looking at a pane and means the agent in it, and wrong for an OFF-MACHINE
 * caller: it would steer an agent the orchestrator did not address, into a PRIVATE turn, with
 * nothing anywhere reporting the swap. The argument `sessions:delete` already makes for a
 * destructive verb, applied to an authority-bearing one.
 */
function readDirected(a) {
  const d = a && a.directed;
  // ⚠ ABSENT is the operator's own keyboard — every pre-existing caller, unchanged.
  if (!d) return null;
  // 🔒 **PRESENT BUT MALFORMED FAILS TOWARD REFUSAL, NOT TOWARD AUTHORITY** (adversarial
  // review, 2026-08-31). A `directed` object with no `id` used to answer `null`, which the
  // caller reads as "the operator typed this" — so the ONE branch where the input is broken
  // was also the one branch that TRUSTED it more. Unreachable on the shipped path
  // (`agent-direction-wire.js` UUID-gates the id first), and the fail direction for an
  // authority-bearing field is not a thing to leave pointing the wrong way.
  if (!d.id) return false;
  if (!String((a && a.agentId) || '')) return false;
  return d;
}

/** Arm the capture and open its window, in the one order that is correct. ⚠ ONE CALL so a
 *  caller cannot arm without opening — an armed capture with a zero depth is spent by the
 *  FIRST `result` to arrive, which may be a channel turn's. */
function armAndOpen(s, directed, turnInFlight) {
  armDirected(s, directed.id, directed.workspaceId);
  return openDirected(s, turnInFlight);
}

/**
 * ARM the capture for a direction just pushed. Returns the session for chaining.
 *
 * ⚠ **IT OVERWRITES RATHER THAN QUEUES, AND THAT IS A DELIBERATE, NARROW LOSS.** Two directions
 * pushed before the first turn ends would each want their own answer, and a session produces
 * one final text per turn — there is no way to attribute two answers to two directions from
 * inside this process. So the SECOND direction wins the capture and the first is left to
 * lazy-expire, which the MCP op already tells its caller not to cause: *"a second direction
 * says the same thing to a live agent twice"*. Reporting the same text to both would be worse
 * — it would tell one orchestrator its question was answered when a different one was.
 */
function armDirected(s, directionId, workspaceId) {
  if (!s) return s;
  s.directed = {
    id: String(directionId || ''),
    workspaceId: String(workspaceId || ''),
    // The last assistant text seen while this capture is armed.
    text: '',
    // ⚠ A DEPTH, exactly like the private window's and for the same reason: a `steer` QUEUES
    // (`priority: 'next'`), so the turn that ends next may be a CHANNEL turn that was already
    // in flight. Spending one per `result` is what makes the capture land on the right turn.
    depth: 0,
  };
  return s;
}

/** Is a directed capture armed right now? The one question the narration tag asks. */
function isDirectedTurn(s) {
  return !!(s && s.directed && s.directed.id);
}

/**
 * OPEN the window for the pushed direction. ⚠ MIRRORS `session-private.js › openPrivateTurn`'s
 * arithmetic EXACTLY — +1 when the agent is idle (the pushed message IS the next turn), +2 when
 * a turn is already in flight (that turn's `result` spends one, leaving the directed turn
 * covered by the second). It is a separate counter rather than a read of `privateDepth` because
 * that one is also incremented by the OPERATOR's own messages, and a capture must not be spent
 * by a turn the operator opened.
 */
function openDirected(s, turnInFlight) {
  if (!isDirectedTurn(s)) return 0;
  s.directed.depth += turnInFlight ? 2 : 1;
  return s.directed.depth;
}

/** Record what the agent just said, while a capture is armed. ⚠ LAST ONE WINS: a turn may emit
 *  several `assistant` blocks and the FINAL text is the answer. */
function noteDirectedText(s, text) {
  if (!isDirectedTurn(s)) return;
  const clean = safeReply(text);
  if (clean) s.directed.text = clean;
}

/**
 * A TURN ENDED. Spend one of the window; when it closes, hand back what to report.
 *
 * ⚠ RETURNS `null` UNTIL THE DIRECTED TURN ITSELF ENDS, so the in-flight channel turn the `+2`
 * covers cannot carry its own final text back to the orchestrator as if it were the answer.
 * ⚠ CLEARS THE CAPTURE ON THE WAY OUT: one direction, one report, ever.
 */
function closeDirected(s) {
  if (!isDirectedTurn(s)) return null;
  s.directed.depth -= 1;
  if (s.directed.depth > 0) {
    // 🔒 **THE TEXT BELONGS TO THE TURN THAT JUST ENDED, NOT TO THE DIRECTION** (adversarial
    // review, 2026-08-31). The `+2` covers a turn that was ALREADY IN FLIGHT — a channel turn,
    // or the OPERATOR's own private turn — and `noteDirectedText` records any `assistant` line
    // while the capture is armed. Without this clear, a directed turn that ends on tool output
    // and says nothing would report the PREVIOUS turn's final text as its reply: a
    // counterparty-facing answer, or the operator's own private words, written off-machine.
    // That is the exact prohibition this module's header states.
    s.directed.text = '';
    return null;
  }
  const out = {
    id: s.directed.id,
    workspaceId: s.directed.workspaceId,
    reply: s.directed.text,
  };
  s.directed = null;
  return out;
}

/**
 * A QUERY WAS TORN DOWN: the capture is DROPPED and NOTHING IS REPORTED.
 *
 * ⚠ **DROPPED, NOT FLUSHED, AND THE DIRECTION IS THE WRONG PLACE TO BE CLEVER.** A park, an
 * auth hold, a crash or an operator End means the turn owes no `result` — so any text captured
 * so far is a PARTIAL answer to a question that was never finished. Reporting it would hand an
 * orchestrator a half-answer indistinguishable from a complete one. The row lazy-expires, and
 * "it lapsed" is the honest thing to tell a caller about a turn nobody finished.
 * ⚠ Called from the same three edges `session-private.js › resetPrivateTurn` is: the
 * `abortQuery` and `denyPending` effects, and `session-park.js › resumeParked`.
 */
function resetDirected(s) {
  if (!s) return null;
  s.directed = null;
  return null;
}

// ─── END SESSION-DIRECTED-PURE ───────────────────────────────────────────────────

/**
 * THE ENGINE'S ONE OBSERVER — called from `session-engine.js`'s single dispatch funnel, on
 * every SDK event, beside the pill projection and the narration ring.
 *
 * ⚠ **ONE CALL SITE, TWO EVENTS**, because the engine is at the §1 cap and because the two
 * halves are one concern: what the agent SAID, and when the turn it said it in ENDED.
 *
 * ⚠ `assistant` ONLY. A `thinking` frame is not an answer, a tool call is not an answer, and a
 * `post` is the one thing in a private turn that did not stay private — none of them may reach
 * the mailbox.
 *
 * 🔒 THE REPORT IS FIRE-AND-FORGET AND A FAILURE IS NOT RETRIED: the row lazy-expires and the
 * orchestrator sees that, which is honest. Blocking the dispatch funnel on an HTTP round trip
 * would stall every session on this machine.
 */
function observe(s, event) {
  if (!event || !isDirectedTurn(s)) return;
  if (event.type === 'assistant') {
    noteDirectedText(s, event.payload && event.payload.text);
    return;
  }
  if (event.type !== 'result') return;
  const done = closeDirected(s);
  if (!done) return;
  try {
    // ⚠ Lazy-required: `agent-directions.js` reaches the network and the store, and this
    // module is sliced and evaluated PURE by its suite.
    void require('./agent-directions').reportDelivered(done);
  } catch (_err) {
    /* a failed report leaves the row to expire, which is the honest terminal state */
  }
}

/**
 * ⚠ **THE TEARDOWN RESETS ARE ON THE ENGINE'S `abortQuery` / `denyPending` EFFECTS, BESIDE
 * `resetPrivateTurn`, AND AN EARLIER VERSION OF THIS FILE ARGUED THEY WERE UNNECESSARY. THAT
 * ARGUMENT WAS WRONG AND THE CORRECTION IS WORTH KEEPING** (adversarial review, 2026-08-31).
 *
 * It claimed a torn-down query could not deliver a `result`, because `session-query.js ›
 * consume` drops a superseded query's tail on `s.query !== q`. Measured against the code, that
 * guard is NOT ARMED at teardown: neither effect nulls `s.query` — only `session-query.js ›
 * abortInFlight` (on relaunch) and `session-park.js › resumeParked` do — so between a park and
 * the next relaunch `s.query === q` and the tail still arrives.
 *
 * The reducer drops those stray events for a parked or ended session, but **`observe` is called
 * from the dispatch funnel AFTER the reducer and outside every one of those guards**. So a park
 * landing mid-directed-turn (an auth hold, the idle timer, an operator End) would leave the
 * capture armed, and the first stray `result` would close it and report a PARTIAL answer marked
 * `delivered` — the one outcome this module says must never happen.
 */
module.exports = {
  observe, // the engine's one hook
  readDirected,
  armAndOpen,
  REPLY_CAP,
  safeReply,
  armDirected,
  openDirected,
  isDirectedTurn,
  noteDirectedText,
  closeDirected,
  resetDirected,
};
