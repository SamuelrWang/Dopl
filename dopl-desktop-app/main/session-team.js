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
// A SUMMON OPENS NOTHING. THE CHAT IS THE INTERFACE (2026-07-31, operator-reported).
// `summon` used to call startSession and emit its arrival line INTO the window it opened, so
// the channel — the one surface both members share — saw no evidence at all that an agent had
// been added, and the operator got a window they never asked for. A summon now posts, AS the
// agent, into the room it was summoned into (session-greeting.js): no window, no window
// budget, no query, no held session. The greeting itself is a CANNED LINE — the operator
// rejected the bounded read-the-room turn the first cut ran ("we don't need to do a first
// turn"), so an arrival costs one POST and nothing else.
//
// A WINDOW IS A SEPARATE, LATER EVENT — `ensureSession` below. It opens the room-bound PARKED
// shell (session-park P2: a real window, NO SDK query, no turns, no cost, and a LAZY WAKE via
// session-reducer's resumeQuery) and it is reached from exactly two places: an addressed
// message that has to wake this agent (channel-agents.routeAddressedAgent), and the operator
// deliberately opening the session (session-reopen / the tray). `freshRun` / `freshFraming`
// are set by startSession for a shell with nothing to resume, so that first turn carries the
// full TEAM framing (prompt-framing.buildTeamTurn) plus the room history as fenced data.
//
// THE SLOT IS (channel, agent), NOT (channel, thread) — store.slotKey. An agent runs ONE
// session per channel whatever thread it is working, and a team session in the main room has
// no thread at all, so keying on the thread would collapse every agent of a channel onto the
// same slot. D1 built the pool for exactly this ("D2 will hand it (channel, agent) and
// nothing in this file changes").

const store = require('./session-store');
const sessionHistory = require('./session-history'); // the ROOM history seed (bind: 'room')
const greeting = require('./session-greeting'); // the arrival: a MESSAGE, not a window
const { diag } = require('./diag');

// ─── BEGIN SESSION-TEAM-PURE (injectable; unit-tested via source extraction) ───
// Every dependency is either a module-scope binding the test replaces (store,
// sessionHistory, greeting, diag) or an injected handle (deps), so the truth tables below
// drive the real shipped code with no host binding of its own.

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
//   room — ANY member of the channel may feed, THE OPERATOR INCLUDED. The listener only ever
//          sees messages of channels this operator watches, so "the room" is exactly what
//          reaches here. This is the widening, and it is NOT a widening of WHETHER the agent
//          acts: addressing still decides that (channel-agents.routeAddressedAgent feeds only
//          a message that names THIS agent, or an untagged one while it is engaged). The room
//          binding says whose words an addressed turn may carry; the law says when a turn
//          happens.
//
// THE OWNER WAS THE ONE MEMBER IT REFUSED, AND THAT WAS THE BUG (2026-07-31). This branch
// used to answer `author !== self`, so the person who summoned the agent — the only party who
// unambiguously MAY drive it — was the single author it would not carry. Paired with the
// route's own self-exclusion it meant an operator could summon an agent and then never speak
// to it: only a PEER could. Both were fossils of the two-party ASSIST model, where a
// self-authored message really was just this machine's own output. It is not any more: a
// person typing "@quartz do X" into their own channel is the product's primary flow.
//
// The property that comparison was standing in for — an agent must not consume its own
// output — is not this predicate's job and never was safely so: an agent's post is authored
// by its OWNER'S account (author_user_id = the owner, author_kind = 'agent'), so
// `author !== self` refused the human and the agent identically. The real brake is
// `engagement.humanAuthored` at the route, which keys on author_kind and therefore separates
// the two. Removing the comparison here removes no bound that was actually holding.
//
// Fails closed on every miss: no session, a settled one, an empty author id, or — FIX S6 —
// an UNRESOLVED operator identity in room mode.
//
// FIX S6: with `selfUserId` still null (the engine resolves it from the listener, and a
// summon can beat that on a cold start or after a sign-out) there is no room membership to
// reason about at all, so room mode refuses rather than guessing. The caller retries on the
// next addressed message, by which time the identity has resolved.
function acceptsInboundFrom(a, authorUserId) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.slotKey(a));
  if (!s || s.settled) return false;
  const author = String(authorUserId || '');
  if (!author) return false;
  if (s.bind === 'room') {
    return !!String((deps.getSelfId && deps.getSelfId()) || '');
  }
  return !!s.counterpartyId && s.counterpartyId === author;
}

// Is a session (live OR parked) already occupying this agent's slot?
function hasSession(a) {
  if (!deps || !deps.sessions) return false;
  const s = deps.sessions.get(store.slotKey(a));
  return !!(s && !s.settled);
}

// The operator-facing line a room-bound shell opens with, when a window is opened for one
// LATER. Plain voice, no em dash, and it states the LAW rather than promising activity: the
// window is open and nothing is running, which is the honest description of a team agent.
function summonNotice(handle) {
  const name = handle ? '@' + String(handle) : 'This agent';
  return name + ' is in the room. Nothing runs until someone addresses it in the channel.';
}

// SUMMON — the arrival, and the ONLY thing `/new-agent` does on this machine.
//
// It opens NO window, takes NO window budget, starts NO session and runs NO turn. It posts
// the canned greeting into the CHANNEL as this agent (session-greeting.greet), which is the
// operator's whole requirement: the way you know an agent came online is that it says so in
// the chat.
//
// Returns { greeted: true } on a confirmed post — the caller (channel-agents.js) then flips
// the row to `active`, because an agent that has greeted the room IS alive and listening —
// or { skipped }, which leaves the row `summoned` for the next reconcile pass to retry.
//
//   'disabled'     window-mode off. That switch gates the whole TEAM lane: with it off,
//                  routeAddressedAgent short-circuits and an @-addressed message could never
//                  reach this agent, so "address me by handle" would be a promise this
//                  machine cannot keep. Greeting is refused rather than lying.
//   'post-failed'  the channel write did not confirm (session-greeting). The greeting is
//                  idempotent per (channel, agent, row stamp), so the retry cannot double-post.
async function summon(a) {
  if (!deps) return { skipped: 'disabled' };
  if (!deps.windowModeEnabled()) return { skipped: 'disabled' };
  return greeting.greet(a);
}

// ENSURE A SESSION — the room-bound parked shell for ONE of my own `channel_agents` rows.
// A WINDOW APPEARS HERE, and only here: this is the lazy wake an addressed message triggers
// (channel-agents.routeAddressedAgent), not something a summon does.
//
// Returns { sessionId } when a shell now owns this agent's slot, { skipped } otherwise.
//
//   'disabled'  window-mode off, or no window factory yet (boot ordering)
//   'busy'      a session already holds this agent's slot (a wake racing another wake)
//   'cap'       the shared window budget is full and no idle shell could be evicted
//   'no-sdk'    the Agent SDK could not be loaded
async function ensureSession(a) {
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
    // PARKED: a window with no query, no turn and no cost. Even when the wake IS an
    // addressed message, the shell starts dormant and the inbound gate decides whether the
    // turn runs — the window exists to show that decision, not to pre-empt it.
    parkedShell: true,
    // FIX 4 (2026-08-02) — A TEAM SESSION CAN BE ARMED AT ALL NOW. `parkedShell: true` is
    // unconditional here, and session-engine.startSession discarded `startModes` for ANY
    // parked shell, so an operator-chosen posture could never reach a team agent: the two
    // facts composed into "a team session always starts manual/ask, whatever was approved",
    // with nothing anywhere saying so. This is the pass-through, and it is deliberately
    // pass-through ONLY — nothing is read from a store here. `operatorArmed` is the engine's
    // gate and a CALLER must set it explicitly, so the peer-driven wake that reaches this
    // function today (channel-deliver.agentSpec, which carries neither field) is unchanged
    // and still starts at manual/ask. A message from the room is not a human approving one.
    startModes: a.startModes,
    operatorArmed: a.operatorArmed === true,
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
  diag('session-team: window opened for', String(a.agentName || a.agentId).slice(0, 24), 'in', String(a.channelId).slice(0, 8));
  return { sessionId: s.sessionId };
}

// ─── END SESSION-TEAM-PURE ────────────────────────────────────────────────────

module.exports = { bind, summon, ensureSession, hasSession, acceptsInboundFrom, summonNotice };
