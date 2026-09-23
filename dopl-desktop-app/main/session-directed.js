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

/** Arm a capture for a direction just pushed and open its window, in one call. ⚠ ONE CALL so
 *  a caller cannot arm without opening — a capture at depth zero would be spent by the FIRST
 *  `result` to arrive, which may be a channel turn's.
 *  `prompt` is the FRAMED text that was pushed; an adapter matches it to say the push JOINED a
 *  live turn ({@link noteSteerJoined}). Absent, the capture can never be joined. */
function armAndOpen(s, directed, turnInFlight, prompt) {
  if (!s || !directed || !directed.id) return 0;
  const id = String(directed.id);
  const list = captures(s);
  // ⚠ One direction, one capture: a re-delivered id must not arm a second report.
  const existing = list.find((c) => c.id === id);
  if (existing) return existing.depth;
  const c = {
    id,
    workspaceId: String(directed.workspaceId || ''),
    // The last assistant text seen while this capture is armed.
    text: '',
    // ⚠ A DEPTH, exactly like the private window's: +1 when the agent is idle (the pushed
    // message IS the next turn), +2 when a turn is already in flight and the push may run as its
    // own later turn — that turn's `result` spends one. When the runtime instead JOINS the push
    // into the running turn, its adapter pays the surplus back through `steerJoined`. It is its
    // own counter because `privateDepth` is also moved by the OPERATOR's messages.
    depth: turnInFlight ? 2 : 1,
    inFlight: !!turnInFlight,
    spent: 0, // `result`s seen since arming
    ended: '', // the text the last NON-closing turn ended on
    joined: false,
    prompt: typeof prompt === 'string' && prompt ? prompt : null,
  };
  list.push(c);
  s.directed = list;
  return c.depth;
}

/**
 * ⚠ **A QUEUE, NOT A SLOT (CXP-3B, 2026-09-22).** This used to be ONE capture that a second
 * direction OVERWROTE, leaving the first to lapse. Measured live on Codex (direction 73c88154):
 * a capture stranded by the join bug below was then silently replaced by the next direction,
 * so the first row sat `claimed` beside a reply the operator could see. Each capture now keeps
 * its OWN depth from the moment it was armed, and every `result` spends one from each — which
 * is what attributes two answers to two directions when the runtime queues them as two turns.
 */
function captures(s) {
  return Array.isArray(s && s.directed) ? s.directed : [];
}

/** Is a directed capture armed right now? The one question the narration tag asks. */
function isDirectedTurn(s) {
  return captures(s).length > 0;
}

/** Record what the agent just said, while a capture is armed. ⚠ LAST ONE WINS: a turn may emit
 *  several `assistant` blocks and the FINAL text is the answer. */
function noteDirectedText(s, text) {
  const list = captures(s);
  if (!list.length) return;
  const clean = safeReply(text);
  if (!clean) return;
  for (const c of list) c.text = clean;
}

/**
 * 🔒 **THE PUSH JOINED THE TURN ALREADY RUNNING (CXP-3B, P4-05).**
 *
 * The `+2` assumes a push while a turn is in flight becomes its OWN later turn. Both runtimes can
 * instead join it to the ACTIVE turn — Codex's `turn/steer` always, Claude's CLI when it folds a
 * queued message in after a tool batch (`runtime/claude/fold.js`) — so ONE `result` answers both,
 * and without this the depth stopped at 1 with its text cleared and the capture stayed armed for
 * the next, unrelated turn. Called by an adapter only once the runtime confirmed the join, and only
 * for the capture whose own framed prompt it carried — a join of some other push must not spend
 * this one, or an in-flight channel turn's text would be reported as the answer.
 *
 * TWO ORDERS, ONE ANSWER. Usually the join lands BEFORE the joined turn's `result` and simply
 * pays off the surplus unit (2 → 1). But the steer's response and `turn/completed` race on the
 * frame queue, so the `result` may already have spent one and cleared the text; the join then
 * proves THAT turn carried the direction, and the capture closes now on the text it ended with.
 * Returns the captures that closed — the caller reports them, exactly as `observe` does.
 */
function noteSteerJoined(s, pushedText) {
  const text = typeof pushedText === 'string' ? pushedText : '';
  if (!text) return [];
  const c = captures(s).find((x) => x.inFlight && !x.joined && x.prompt && text.includes(x.prompt));
  if (!c) return [];
  c.joined = true;
  if (c.spent === 0) {
    c.depth -= 1;
    return [];
  }
  // ⚠ `spent === 1`: the joined turn already ended — its text is the answer.
  s.directed = captures(s).filter((x) => x !== c);
  if (!s.directed.length) s.directed = null;
  return [{ id: c.id, workspaceId: c.workspaceId, reply: c.ended }];
}

/**
 * A TURN ENDED. Spend one from every capture; hand back each one whose window just closed.
 *
 * ⚠ RETURNS `[]` UNTIL A DIRECTED TURN ITSELF ENDS, so the in-flight channel turn the `+2`
 * covers cannot carry its own final text back to the orchestrator as if it were the answer.
 * ⚠ A CLOSED CAPTURE IS REMOVED ON THE WAY OUT: one direction, one report, ever.
 */
function closeDirected(s) {
  const list = captures(s);
  if (!list.length) return [];
  const out = [];
  const keep = [];
  for (const c of list) {
    c.depth -= 1;
    c.spent += 1;
    if (c.depth > 0) {
      // Kept ONLY for a late steer join (`noteSteerJoined`), which proves this turn was the one.
      c.ended = c.text;
      // 🔒 **THE TEXT BELONGS TO THE TURN THAT JUST ENDED, NOT TO THE DIRECTION** (adversarial
      // review, 2026-08-31). The `+2` covers a turn that was ALREADY IN FLIGHT — a channel turn,
      // or the OPERATOR's own private turn. Without this clear, a directed turn that ends on tool
      // output and says nothing would report the PREVIOUS turn's final text as its reply.
      c.text = '';
      keep.push(c);
    } else {
      out.push({ id: c.id, workspaceId: c.workspaceId, reply: c.text });
    }
  }
  s.directed = keep.length ? keep : null;
  return out;
}

/**
 * A QUERY WAS TORN DOWN OR INTERRUPTED: every capture is DROPPED and NOTHING IS REPORTED.
 *
 * ⚠ **DROPPED, NOT FLUSHED, AND THE DIRECTION IS THE WRONG PLACE TO BE CLEVER.** A park, an
 * auth hold, a crash, an operator End or a Pause means the turn was never finished — so any text
 * captured so far is a PARTIAL answer. The row lazy-expires, and "it lapsed" is the honest thing
 * to tell a caller about a turn nobody finished.
 * ⚠ Called from the edges `session-private.js › resetPrivateTurn` is — the `abortQuery` and
 * `denyPending` effects, and `session-park.js › resumeParked` — plus `interruptQuery` (P4-08):
 * an interrupted turn still ends with a `result`, which would otherwise close the capture.
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
  report(closeDirected(s));
}

/** AN ADAPTER'S HOOK — the runtime joined a push into the running turn: the private window and the
 *  directed capture it opened each pay back the push's own turn. Lazy: `session-private` reaches the
 *  runtime registry, which requires this module. */
function steerJoined(s, pushedText) {
  require('./session-private').privatePushJoined(s, pushedText);
  report(noteSteerJoined(s, pushedText));
}

function report(closed) {
  for (const done of closed) {
    try {
      // ⚠ Lazy-required: `agent-directions.js` reaches the network and the store, and this
      // module is sliced and evaluated PURE by its suite.
      void require('./agent-directions').reportDelivered(done);
    } catch (_err) {
      /* a failed report leaves the row to expire, which is the honest terminal state */
    }
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
  steerJoined, // CXP-3B / P4-05: the adapters' join hook (Codex steer, Claude fold)
  readDirected,
  armAndOpen,
  REPLY_CAP,
  safeReply,
  isDirectedTurn,
  noteSteerJoined, // CXP-3B / P4-05: a push joined the live turn
  noteDirectedText,
  closeDirected,
  resetDirected,
};
