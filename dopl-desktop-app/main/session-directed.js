// The DIRECTED turn: a turn opened by an MCP direction from another of the operator's agents. It owns ATTRIBUTION
// (the operator can tell their agent's words from their own) and the REPLY CAPTURE: the final text of ONE turn goes
// back to the mailbox, and nothing else in the private lane ever does. The gate is `session-private.js`'s, unchanged.
// A torn-down query reports nothing: the row lazy-expires, the honest end for an outcome nobody observed.

// ─── BEGIN SESSION-DIRECTED-PURE (pure; unit-tested via source extraction) ────────

// The bound the column CHECK and the route schema carry; truncating here beats 400ing the decide.
const REPLY_CAP = 8000;

// Controls stripped like a label's (one would 400 the decide), but `\n` and `\t` survive: a reply is a BODY.
// Written as escapes, never literals.
const UNSAFE_REPLY_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/gu;

// '' for anything unusable; the caller decides what '' means.
function safeReply(text) {
  if (typeof text !== 'string') return '';
  return text.replace(UNSAFE_REPLY_RE, '').slice(0, REPLY_CAP);
}

/**
 * The direction on a `messageByTask` call: null (the operator's own keyboard), the direction, or `false` for one
 * that is malformed (no id, or no agent named), which the caller refuses. It fails toward refusal, never toward
 * operator authority, and has no oldest-agent fallback: an off-machine caller must name the agent it steers.
 */
function readDirected(a) {
  const d = a && a.directed;
  if (!d) return null;
  if (!d.id) return false;
  if (!String((a && a.agentId) || '')) return false;
  return d;
}

/** Arm a capture for a pushed direction and open its window in ONE call (a capture at depth 0 would be spent by
 *  the next channel turn's result). One capture per direction id. `prompt` is the framed text a join is matched by. */
function armAndOpen(s, directed, turnInFlight, prompt) {
  if (!s || !directed || !directed.id) return 0;
  const id = String(directed.id);
  const list = captures(s);
  const existing = list.find((c) => c.id === id);
  if (existing) return existing.depth;
  const c = {
    id,
    workspaceId: String(directed.workspaceId || ''),
    text: '',
    // +1 when idle; +2 when a turn is in flight (its own result spends one). A runtime that JOINS the push into the
    // running turn pays the surplus back through `steerJoined`.
    depth: turnInFlight ? 2 : 1,
    inFlight: !!turnInFlight,
    spent: 0,
    ended: '',
    joined: false,
    prompt: typeof prompt === 'string' && prompt ? prompt : null,
  };
  list.push(c);
  s.directed = list;
  return c.depth;
}

// A queue, not a slot: each capture keeps its own depth, so two directions queued as two turns get two answers.
function captures(s) {
  return Array.isArray(s && s.directed) ? s.directed : [];
}

function isDirectedTurn(s) {
  return captures(s).length > 0;
}

// Last one wins: the turn's FINAL text is the answer.
function noteDirectedText(s, text) {
  const list = captures(s);
  if (!list.length) return;
  const clean = safeReply(text);
  if (!clean) return;
  for (const c of list) c.text = clean;
}

/**
 * The runtime JOINED the push into the running turn (Codex `turn/steer`; Claude's mid-turn fold), so one result
 * answers both. Matched by the capture's own framed prompt, so another push's join cannot spend it. Before the
 * joined turn's result it pays back the surplus unit; after it, the capture closes on that turn's text.
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
  s.directed = captures(s).filter((x) => x !== c);
  if (!s.directed.length) s.directed = null;
  return [{ id: c.id, workspaceId: c.workspaceId, reply: c.ended }];
}

/** A turn ended: spend one from every capture and hand back the ones that closed (removed on the way out). */
function closeDirected(s) {
  const list = captures(s);
  if (!list.length) return [];
  const out = [];
  const keep = [];
  for (const c of list) {
    c.depth -= 1;
    c.spent += 1;
    if (c.depth > 0) {
      c.ended = c.text;
      // Clear the text of a NON-closing turn, else a directed turn ending on tool output reports this one's text.
      c.text = '';
      keep.push(c);
    } else {
      out.push({ id: c.id, workspaceId: c.workspaceId, reply: c.text });
    }
  }
  s.directed = keep.length ? keep : null;
  return out;
}

// A query torn down or interrupted: drop every capture, report nothing (a partial answer is not an answer). Called
// from the engine's abortQuery / denyPending / interruptQuery effects and `resumeParked`: `observe` runs after the
// reducer, outside its park guards, and `s.query !== q` is not armed at teardown, so a stray result could close it.
function resetDirected(s) {
  if (!s) return null;
  s.directed = null;
  return null;
}

// ─── END SESSION-DIRECTED-PURE ───────────────────────────────────────────────────

/** The engine's one observer, on every dispatch: `assistant` text is noted, a `result` closes. The report is
 *  fire-and-forget (a failure lets the row expire); blocking the funnel on HTTP would stall every session. */
function observe(s, event) {
  if (!event || !isDirectedTurn(s)) return;
  if (event.type === 'assistant') {
    noteDirectedText(s, event.payload && event.payload.text);
    return;
  }
  if (event.type !== 'result') return;
  report(closeDirected(s));
}

/** An adapter's hook: the runtime joined a push into the running turn, so the private window and the directed
 *  capture it opened each pay back the push's own turn. Lazy: `session-private` reaches the runtime registry. */
function steerJoined(s, pushedText) {
  const windows = require('./session-private');
  windows.privatePushJoined(s, pushedText);
  windows.peerPushJoined(s, pushedText);
  report(noteSteerJoined(s, pushedText));
}

// Lazy: `agent-directions.js` reaches the network and the store.
function report(closed) {
  for (const done of closed) {
    try {
      void require('./agent-directions').reportDelivered(done);
    } catch (_err) {
    }
  }
}

module.exports = {
  observe,
  steerJoined,
  readDirected,
  armAndOpen,
  REPLY_CAP,
  safeReply,
  isDirectedTurn,
  noteSteerJoined,
  noteDirectedText,
  closeDirected,
  resetDirected,
};
