// session-team.js — the TEAM session: summoned by its own operator, bound to the ROOM.
//
// TWO SESSION MODES, ONE ENGINE (docs/MULTIPLAYER-PLAN.md). ASSIST is today's session:
// pair-bound, opened by a consent-gated inbound trigger, fenced to ONE counterparty by
// FIX L1 (session-dispatch) and FIX F4 (session-history). TEAM is the multiplayer shape:
// its operator summons it with `/new-agent`, it is a first-class named entity in the
// channel, and it listens to the whole ROOM rather than to one peer. Nothing about ASSIST
// moves — `bind` defaults to 'pair' at every construction site, so a session is room-bound
// only because a caller here asked for it.
//
// EXTRACTED FROM THE ENGINE, like session-park / session-gate / session-reopen, because
// session-engine.js sits at the §2 500-line cap. The engine injects its private registry
// (`sessions`), its single construction site (`startSession`), and the handles this module
// cannot require (getSdk, emit, the window budget). Nothing here requires the engine back,
// so there is no cycle.
//
// WHY A SUMMON OPENS A PARKED SHELL AND NOT A RUNNING QUERY. The law is "nothing acts
// unless addressed". A summon is not an instruction, it is an arrival: the operator has put
// an agent in the room, and until somebody addresses it there is nothing for it to do. A
// parked shell is exactly that state and the machinery already exists (session-park P2): a
// real window, NO SDK query, no turns, no cost, and a LAZY WAKE (session-reducer's
// resumeQuery) the first addressed message triggers. `freshRun` / `freshFraming` are set by
// startSession for a shell with nothing to resume, so that first turn carries the full TEAM
// framing (prompt-framing.buildTeamTurn) plus the room history as fenced data.
//
// THE SLOT IS (channel, agent), NOT (channel, thread) — store.slotKey. An agent runs ONE
// session per channel whatever thread it is working, and a team session in the main room has
// no thread at all, so keying on the thread would collapse every agent of a channel onto the
// same slot. D1 built the pool for exactly this ("D2 will hand it (channel, agent) and
// nothing in this file changes").

const store = require('./session-store');
const sessionHistory = require('./session-history'); // the ROOM history seed (bind: 'room')
const { diag } = require('./diag');

// ─── BEGIN SESSION-TEAM-PURE (injectable; unit-tested via source extraction) ───
// Every dependency is either a module-scope binding the test replaces (store,
// sessionHistory, diag) or an injected handle (deps), so the truth tables below drive the
// real shipped code with no host binding of its own.

let deps = null;

// The engine binds { sessions, startSession, getSdk, emit, windowModeEnabled, atWindowCap,
// windowFactoryReady, getSelfId } at load. Read at CALL time, so bind order at module load
// does not matter.
function bind(d) {
  deps = d || null;
}

// PURE — MAY THIS SESSION CONSUME A TURN FROM THIS AUTHOR? The one predicate the two
// bindings differ on, and the reason `bind` is a persisted field rather than an inference.
//
//   pair — FIX L1 unchanged, byte for byte: only the task's bound counterparty feeds. A
//          third member posting in the same channel can never inject a turn, and a session
//          with no counterparty bound accepts NOBODY.
//   room — any OTHER member of the channel may feed. The listener only ever sees messages
//          of channels this operator watches, so "an author that is not the operator" is
//          exactly the room. This is the widening, and it is NOT a widening of WHETHER the
//          agent acts: addressing still decides that (channel-agents.routeAddressedAgent
//          feeds only a message whose `to_agent_id` names THIS agent). The room binding
//          says whose words an addressed turn may carry; the law says when a turn happens.
//          The operator's OWN messages are excluded here as well as at the route, because
//          a self-authored message is already this machine's own output.
//
// Fails closed on every miss: no session, a settled one, an empty author id, or — FIX S6 —
// an UNRESOLVED operator identity in room mode.
//
// FIX S6: the room branch used to answer `author !== String(getSelfId() || '')`, so while
// `selfUserId` was still null (the engine resolves it from the listener, and a summon can
// beat that on a cold start or after a sign-out) the comparison was `author !== ''`, which is
// TRUE for everybody — including this machine's own output, the one author the room binding
// is documented to exclude. The predicate that is supposed to be the fence answered "yes" to
// every id it was asked about. With no self id there is no room membership to reason about,
// so it refuses; the caller retries on the next addressed message, by which time the identity
// has resolved.
function acceptsInboundFrom(a, authorUserId) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.slotKey(a));
  if (!s || s.settled) return false;
  const author = String(authorUserId || '');
  if (!author) return false;
  if (s.bind === 'room') {
    const self = String((deps.getSelfId && deps.getSelfId()) || '');
    return !!self && author !== self;
  }
  return !!s.counterpartyId && s.counterpartyId === author;
}

// Is a session (live OR parked) already occupying this agent's slot?
function hasSession(a) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.slotKey(a));
  return !!(s && !s.settled);
}

// The operator-facing line a freshly summoned shell opens with. Plain voice, no em dash,
// and it states the LAW rather than promising activity: the window is open and nothing is
// running, which is the honest description of a summoned agent.
function summonNotice(handle) {
  const name = handle ? '@' + String(handle) : 'This agent';
  return name + ' is in the room. Nothing runs until someone addresses it in the channel.';
}

// Summon: open the room-bound parked shell for ONE of my own `channel_agents` rows.
//
// Returns { sessionId } when a shell now owns this agent's slot, { skipped } otherwise.
// The caller (channel-agents.js) flips the row to `active` ONLY on a sessionId, so a
// refused summon leaves the row `summoned` and the next reconcile pass tries again —
// there is no state in which the server believes an agent is running on a machine that
// refused to start it.
//
//   'disabled'  window-mode off, or no window factory yet (boot ordering)
//   'busy'      a session already holds this agent's slot (a reconcile re-run, or a
//               summon racing the addressed-message route that spawns on demand)
//   'cap'       the shared window budget is full and no idle shell could be evicted
//   'no-sdk'    the Agent SDK could not be loaded
async function summon(a) {
  if (!deps || !deps.startSession) return { skipped: 'disabled' };
  if (!deps.windowModeEnabled() || !deps.windowFactoryReady()) return { skipped: 'disabled' };
  const slot = { channelId: a.channelId, agentId: a.agentId };
  if (hasSession(slot)) return { skipped: 'busy' };
  if (deps.atWindowCap()) return { skipped: 'cap' };
  let sdk = null;
  try {
    sdk = await deps.getSdk();
  } catch (err) {
    diag('session-team: SDK unavailable', err && err.message);
    return { skipped: 'no-sdk' };
  }
  if (hasSession(slot)) return { skipped: 'busy' }; // re-check after the await (FIX #7 discipline)
  const s = await deps.startSession({
    key: store.slotKey(slot),
    channelId: a.channelId,
    // NO THREAD. A team agent lives in the room; it threads a reply when it answers inside
    // one, and the outbound tag (session-outbound-tag) then has nothing of its own to force,
    // which is correct — forcing the AGENT id as a thread id is the bug this avoids.
    taskId: '',
    agentId: a.agentId,
    bind: 'room',
    workspaceId: a.workspaceId,
    side: 'responder', // it answers the room; the reducer + renderer know only the two sides
    profile: a.toolProfile,
    mode: 'autonomous',
    // The parked shell IS the summon: a live window, no query, no turn, no cost, waiting
    // for the first addressed message to wake it (session-reducer resumeQuery).
    parkedShell: true,
    context: {
      channelName: a.channelName || null,
      channelId: a.channelId,
      workspaceId: a.workspaceId,
      // D2: the agent's OWN identity, carried the same way the channel + workspace ids are
      // — on the spawn context, which is the only thing prompt-framing reads.
      agentId: a.agentId,
      agentName: a.agentName || null,
      ownerName: a.ownerName || null,
    },
  }, sdk);
  if (!s) return { skipped: 'disabled' };
  // The operator sees WHY this window is open and why it is quiet.
  try { deps.emit(s, { type: 'notice', level: 'info', text: summonNotice(a.agentName) }); } catch (_) { /* window may be gone */ }
  // Paint (and stash as the fresh run's seed) the ROOM's recent messages. Awaited for the
  // same reason recreateParkedShell awaits it: the entries must be stashed before the shell
  // can take its first turn, or the agent wakes with no idea what the room has been saying.
  try { await sessionHistory.load(s); } catch (err) { diag('session-team: history load failed', err && err.message); }
  diag('session-team: summoned', String(a.agentName || a.agentId).slice(0, 24), 'in', String(a.channelId).slice(0, 8));
  return { sessionId: s.sessionId };
}

// ─── END SESSION-TEAM-PURE ────────────────────────────────────────────────────

module.exports = { bind, summon, hasSession, acceptsInboundFrom, summonNotice };
