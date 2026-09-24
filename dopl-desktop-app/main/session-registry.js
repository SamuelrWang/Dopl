// THE MULTIPLAYER REGISTRY READS — "which of my agents does this address name?"
//
// ⚠ (channel, thread) STOPPED IDENTIFYING A SESSION ON 2026-08-21 (Samuel's multiplayer
// ruling). It is a GROUP now — every one of this operator's agents working that thread — and an
// empty thread id is a group too: the CHANNEL-LEVEL agents, whose scope is the channel's main
// room. The four reads below are the ONLY sanctioned way to ask about either. Nothing outside
// this file may iterate the registry or parse a key apart: the key is COMPARED, never split, so
// nothing comes to depend on its internal shape.
//
// ⚠ WHY ITS OWN FILE. `session-engine.js` sits under the hard 500-line §2 cap and these reads
// pushed it over. The seam is real rather than arithmetic: the engine is the IMPERATIVE SHELL
// (it owns the SDK query, the effects, the lifecycle), while this answers ADDRESSING questions
// about the registry and mutates nothing. It follows the `session-reopen.js` / `session-gate.js`
// idiom exactly — the engine injects its in-memory Map via `bind()` at load, this module holds
// no electron/SDK handle and never requires back into the engine, so there is no cycle. The
// engine re-exports the reads under its own name, so every existing caller is unchanged.
//
// ⚠ EVERY FUNCTION HERE IS A PURE READ. If one ever needs to mutate a session, it belongs in the
// engine: the value of this seam is that a caller can reason about it without knowing what a
// dispatch does. `noteSiblings` is the single exception and it writes only DISPLAY CONTEXT (the
// framing's agent id and name) onto `s.context`, never reducer state.

const store = require('./session-store');

// ─── BEGIN SESSION-REGISTRY-PURE (injectable; unit-tested via source extraction) ───

let deps = { sessions: null, nameOf: null };

/** The engine binds its in-memory `sessions` Map (and the rename store's read, `nameOf`) here at
 *  load. Read at CALL time, so bind order at module load does not matter. */
function bind(d) {
  deps = {
    sessions: (d && d.sessions) || null,
    nameOf: (d && typeof d.nameOf === 'function') ? d.nameOf : null,
  };
}

/**
 * EVERY live session on one thread, in SPAWN ORDER.
 *
 * ⚠ THE ORDER IS LOAD-BEARING and comes free from the Map's insertion order. Two callers depend
 * on it: the AMBIGUITY FALLBACK (`sessionOn` below, and `session-reopen.js › resolveSession`),
 * where an op that names no agent takes the OLDEST live one — which is byte-for-byte what every
 * caller got when a thread could hold only one session — and the framing's sibling list, which
 * reads better oldest-first.
 *
 * ⚠ AN EMPTY `taskId` IS A REAL SCOPE, not a missing value: it selects the CHANNEL-LEVEL agents,
 * and `threadKeyPrefix`'s trailing colon is what stops it also matching every threaded one.
 */
function liveOnThread(a) {
  const prefix = store.threadKeyPrefix(String((a && a.channelId) || ''), String((a && a.taskId) || ''));
  const out = [];
  if (!deps.sessions) return out;
  for (const s of deps.sessions.values()) {
    if (s.settled) continue;
    if (String(s.key || '').indexOf(prefix) !== 0) continue;
    out.push(s);
  }
  return out;
}

/** The agent ids of every live session on a thread (or in the main room). */
function agentIdsOnThread(a) {
  return liveOnThread(a).map((s) => String(s.agentId || '')).filter(Boolean);
}

/**
 * EVERY LIVE SESSION OF THIS OPERATOR'S IN ONE CHANNEL, thread-scoped or not —
 * the ROOM ROSTER's local half (2026-09-18).
 *
 * 🔒 ⚠ **`agentIdsInChannel` WAS DELETED HERE ON 2026-09-02 (F-579) AND THIS IS NOT IT COMING
 * BACK.** That read existed for the ~870-character voluntary CLAIM PROTOCOL — a paragraph that
 * asked an agent to decide whether an unaddressed message was its own — and its deletion note
 * carries the rule that survives: **a channel-wide roster must never become the FAN-OUT's
 * input.** It is not one here. `session-dispatch.js` still feeds only the recipient the server
 * resolved; what this answers is a DISPLAY question — *who else is in this room, so an agent can
 * ADDRESS the right one* — which is the opposite of deciding whether to answer.
 *
 * ⚠ **IT RETURNS SESSION OBJECTS, NOT IDS.** The card names an agent by its handle, says whose
 * it is, and names its ROLE when it has one, so an id alone would send the caller back into the
 * registry for the other two fields.
 * ⚠ SPAWN ORDER, like {@link liveOnThread}, and for the same reason: a list read by a human or
 * an agent reads better oldest-first.
 */
function liveInChannel(channelId) {
  const prefix = `${String(channelId || '')}:`;
  const out = [];
  if (!deps.sessions || !channelId) return out;
  for (const s of deps.sessions.values()) {
    if (s.settled) continue;
    if (String(s.key || '').indexOf(prefix) !== 0) continue;
    out.push(s);
  }
  return out;
}

/**
 * ONE session, for an op that names (channel, thread) and MAY name an agent.
 *
 * ⚠ THE AMBIGUITY RULE IS DELIBERATE AND IT IS THE COMPATIBLE ONE. An `agentId` resolves
 * EXACTLY — a wrong or dead id answers NOTHING rather than falling back, because "pause my
 * agent" must never pause a different one. NO `agentId` takes the OLDEST live session on the
 * thread, which is exactly what every caller got before multiplayer existed (there was only ever
 * one), so an older renderer, the deep-link lanes and the agent window all keep working
 * unchanged. It is only ever ambiguous in the case that could not previously arise, and the fix
 * for that case is for the caller to name the agent — which every op on the bridge now can.
 */
function sessionOn(a) {
  const agentId = String((a && a.agentId) || '');
  if (!deps.sessions) return null;
  if (agentId) {
    const s = deps.sessions.get(store.slotKey({
      channelId: (a && a.channelId) || '', taskId: (a && a.taskId) || '', agentId: agentId,
    }));
    return s && !s.settled ? s : null;
  }
  return liveOnThread(a)[0] || null;
}

/**
 * Stamp this session's context with its own agent id AND display name, for the framing
 * (`prompt-framing-self.js › agentSelfFraming` reads `ctx.agentId` / `ctx.agentName`).
 *
 * ⚠ IT WRITES ONTO `s.context` rather than being read at framing time because `session-seed.js`
 * assembles the turn and holds no registry handle (it is required BY the engine, never back into
 * it).
 * ⚠ THE NAME IS RE-READ FROM THE RENAME STORE ON EVERY STAMP, never carried on the record: a
 * rename, a park and a resume all land on the name the store holds now. A read that
 * throws costs the name line, never the stamp; no name clears a stale one.
 * The function's name predates the sibling roster's removal.
 */
function noteSiblings(s) {
  if (!s || !s.context) return;
  s.context.agentId = String(s.agentId || '');
  let name = '';
  try { name = deps.nameOf && s.agentId ? String(deps.nameOf(s.agentId) || '').trim() : ''; } catch (_) { name = ''; }
  if (name) s.context.agentName = name;
  else delete s.context.agentName;
}

// ─── END SESSION-REGISTRY-PURE ────────────────────────────────────────────────────

module.exports = { bind, liveOnThread, liveInChannel, agentIdsOnThread, sessionOn, noteSiblings };
