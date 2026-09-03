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
// framing's agent id) onto `s.context`, never reducer state.

const store = require('./session-store');

// ─── BEGIN SESSION-REGISTRY-PURE (injectable; unit-tested via source extraction) ───

let deps = { sessions: null };

/** The engine binds its in-memory `sessions` Map here at load. Read at CALL time, so bind
 *  order at module load does not matter. */
function bind(d) {
  deps = { sessions: (d && d.sessions) || null };
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

// ⚠ `agentIdsInChannel` WAS DELETED HERE ON 2026-09-02 (F-579, closed in the batch-2 review).
// It answered "every live agent id in this CHANNEL" for ONE reader: the ~870-character voluntary
// claim protocol in `prompt-framing.js › agentIdentityFraming`, which B9 deleted whole with the
// triage tier. `noteSiblings` stopped stamping `context.siblingAgentIds` in the same change; this
// function computed that field and nothing else ever called it, so it survived as an exported
// registry read answering a question nobody asks — the shape a future paragraph gets written
// around. ⚠ THE THREAD-SCOPED `agentIdsOnThread` IS LIVE AND STAYS: it is a different question.
// ⚠ AND THE OLD DOCTRINE IT CARRIED IS NOT LOST, because it is the delivery core's rule and is
// stated there: knowing a sibling exists is not the same as hearing it, and the FEED is strictly
// scoped in `session-dispatch.js`. A channel-wide roster must never become the fan-out's input.

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
 * Stamp this session's context with its own agent id, for the framing.
 *
 * ⚠ IT WRITES ONTO `s.context` rather than being read at framing time because `session-seed.js`
 * assembles the turn and holds no registry handle (it is required BY the engine, never back into
 * it).
 *
 * ⚠ **THE SIBLING ROSTER IS GONE (2026-09-02, G13).** This also stamped
 * `context.siblingAgentIds` — every other agent live in the channel — and
 * `prompt-framing.js › agentIdentityFraming` was its only reader, for the voluntary claim
 * protocol that narrowed delivery deleted. Nothing else ever read it, so the field went with the
 * paragraph rather than staying as a value nobody consumes. ⚠ The NAME survives because what it
 * stamps now — the id — was always half of what it did.
 */
function noteSiblings(s) {
  if (!s || !s.context) return;
  s.context.agentId = String(s.agentId || '');
}

// ─── END SESSION-REGISTRY-PURE ────────────────────────────────────────────────────

module.exports = { bind, liveOnThread, agentIdsOnThread, sessionOn, noteSiblings };
