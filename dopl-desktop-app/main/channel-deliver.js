// channel-deliver.js — HANDING ONE CHANNEL MESSAGE TO ONE AGENT OF MINE.
//
// SPLIT NOTE (§2, 2026-08-01): this came out of channel-agents.js when the self-echo filter
// moved down here and pushed that file past the 500-line cap. The seam is the honest one —
// two reasons to change, not one:
//   THERE (channel-agents.js)  WHICH of my agents a message is for. Reconcile, summon, and the
//                              three routing lanes (addressed, thread, engaged).
//   HERE                       WHETHER and HOW it actually reaches one. Wake the session if
//                              nothing is running, refuse a self-echo, check the room binding,
//                              label the author, hand it to the inbound gate.
// channel-agents.js requires this module; nothing here requires it back, so there is no cycle.
//
// ── WHY THE SELF-ECHO FILTER LIVES HERE, AND NOWHERE ELSE (incident 2026-08-01) ─────
// It used to sit inside routeThread's participant loop, which is the lane it was written for
// and NOT the only lane that can reach an agent. One filter, at the one point every lane's
// delivery passes, is the whole design: a fourth lane added later inherits it by construction
// instead of by somebody remembering. `selfEcho` states why the old shape was also too narrow.
//
// The other feed path on this machine — session-dispatch's pair (ASSIST) routes — cannot carry
// a self-echo at all: it refuses `m.authorUserId === myUserId` outright, and a pair session has
// no agent identity to echo (session-engine's `agentId` is null for it). So "every path that
// can express the bug passes through here" is a statement about the whole app, not just about
// this file.

const io = require('./listener-io'); // the listener's authenticated fetch (cookie + ws header)
const targeting = require('./targeting');
const sessionEngine = require('./session-engine');
const engagement = require('./channel-engagement'); // WHO wrote a message (the loop brake)
const roster = require('./channel-roster'); // WHAT the server says about this channel's agents
const { diag } = require('./diag');

// ─── BEGIN CHANNEL-DELIVER-PURE (injectable; unit-tested via source extraction) ────
// Every dependency is one of the module-top requires referenced as a FREE VARIABLE — io,
// targeting, sessionEngine, engagement, roster, diag. The truth tables slice this block whole
// and drive the REAL delivery rule with fakes standing in for HTTP and the host-bound engine.

// ── What every lane needs to know about one agent of mine ────────────────────────
// One shape, two consumers (the greeting and the window), so the two can never disagree
// about which agent, which room, or whose machine.
//   `direct` / `ownerUserId` exist for the greeting alone: in a DM the server addresses
//   every post for you, so the arrival has to name an addressee the loop brake reads as
//   noise (session-greeting.directAddressee).
//   `agentStamp` is the row's own `updatedAt` — the greeting's idempotency unit, so a
//   retry dedupes while a row summoned again after a dismissal greets again.
function agentSpec(entry, row, myId) {
  return {
    channelId: entry.channel.id,
    workspaceId: entry.workspaceId,
    agentId: row.id,
    agentName: row.name,
    agentStamp: row.updatedAt || '',
    ownerName: io.displayNameFor(myId),
    ownerUserId: myId,
    channelName: entry.channel.name,
    direct: !!(entry.channel && entry.channel.isDirect === true),
    toolProfile: targeting.resolveToolProfile(entry.channel),
  };
}

// ── A message reached this agent → open its session ──────────────────────────────
// The other half of the summon, and the ONLY caller that opens a window for a team agent
// besides the operator's own "Open session" click: a message is FOR this agent — named, or
// untagged while it is engaged — and nothing is running here, so the room-bound parked shell is
// created now (session-team.ensureSession) and the row is put back to `active`. A refusal
// starts nothing at all — see the four verdicts on routeAddressedAgent — because a pair
// session standing in for a named agent is the failure FIX S2 closed.
async function wakeTeamAgent(entry, row, myId) {
  const res = await sessionEngine.wakeTeamSession(agentSpec(entry, row, myId));
  if (res && res.sessionId) {
    await roster.setStatus(entry, row.id, roster.ACTIVE);
    return true;
  }
  diag('agents: wake not started', String(row.name || row.id).slice(0, 24), (res && res.skipped) || 'unknown');
  return false;
}

// ── THE SELF-ECHO FILTER — an agent is never fed its own words ───────────────────
//
// WHAT WENT WRONG. The old filter was one line inside routeThread's loop:
//   if (row.id === authorAgentId) continue;   // authorAgentId = metadata.author_agent_id
// It is correct exactly when the post carries a stamped `author_agent_id`, and BLIND when it
// does not — because '' matches no row id, so an UNATTRIBUTED post was delivered to every one
// of my agents in the thread, the author included. The server stamps that field only from a
// validated top-level `authorAgentId` (the MCP surface's `as_agent`), so any post an agent
// makes without passing it is unattributed by construction: in the live run an agent's own
// `create_thread` came straight back to it as an inbound turn. And because the thread lane
// deliberately has no `myOwnAgentSpoke` brake (two of my agents in a breakout room is the
// feature), nothing else in the path was going to stop it.
//
// SO THE FILTER ANSWERS ON WHAT IT KNOWS, IN THAT ORDER:
//   ATTRIBUTED    the post names its author. Refuse exactly that agent — unchanged, and it
//                 still lets my other agents in the thread hear it, which is the feature.
//   UNATTRIBUTED  the post names NO author and one of my own agents wrote it (my account,
//                 not a person — `humanAuthored` is the shared answer to that question). It
//                 could be THIS agent and nothing can say otherwise, so it is refused for
//                 all of them. Losing an unattributed agent-to-agent hop costs a message an
//                 operator can resend; feeding one costs a loop with no second party in it.
// A PERSON'S message is never a self-echo, whoever they are — that is the primary flow.
function selfEcho(m, myUserId, row) {
  const authorAgentId = targeting.metaStr(m, 'author_agent_id');
  if (authorAgentId) return authorAgentId === row.id;
  return m.authorUserId === myUserId && !engagement.humanAuthored(m);
}

// ── THE DELIVERY, shared by every lane ────────────────────────────────────────────
// Refuse a self-echo, wake if nothing is running, check the binding, feed. The only thing the
// lanes disagree about is how they got here.
async function deliverToAgent(entry, m, myUserId, row) {
  const named = String(row.name || row.id).slice(0, 24);
  if (selfEcho(m, myUserId, row)) {
    diag('agents: self-echo refused for', named, 'seq', m.seq, '- an agent is never fed its own post');
    return 'refused';
  }
  const slot = { channelId: entry.channel.id, agentId: row.id };
  if (!sessionEngine.hasLiveSession(slot)) {
    // No session on this machine — the NORMAL state of a greeted agent, since a summon
    // starts nothing. THIS is where the session (and its window) comes from. Also covers a
    // restart, an evicted shell, or a row that arrived while push was down.
    if (!(await wakeTeamAgent(entry, row, myUserId))) {
      diag('agents: could not start', named, 'for seq', m.seq, '- nothing started');
      return 'refused';
    }
    const cached = roster.rowsFor(entry.channel.id);
    if (cached.length) roster.noteRoster(entry, cached, myUserId);
  }
  // The ROOM binding decides whose words this session may carry. It fails closed, so a
  // pair-bound session that somehow occupies this slot refuses rather than widening.
  if (!sessionEngine.acceptsInboundFrom(slot, m.authorUserId)) {
    diag('agents: refused inbound for', named, '(binding)');
    return 'refused';
  }
  const fed = sessionEngine.feedInbound({
    channelId: entry.channel.id,
    agentId: row.id,
    message: m.body,
    // THE THREAD THIS TURN ARRIVED IN (2026-08-01, the adversarial review of F1-F7).
    //
    // A TEAM session's SLOT is (channel, agent) and its spawn context is keyed `taskId: ''` on
    // purpose (session-team.js): an agent lives in the ROOM and works whatever thread it is
    // asked in, so keying the slot on a thread would collapse every agent of a channel onto one
    // session. The cost of that — invisible until F1 started thread-routing milestones into team
    // sessions — is that prompt-framing.firstActions gates the "SECOND action: read thread=<id>"
    // order on `ctx.taskId`, so the one session shape that wakes up INSIDE an exchange it has
    // none of was the one shape never told to read it.
    //
    // So the thread rides the DELIVERY, not the slot: it is a fact about THIS TURN (which
    // message woke the agent), it is carried the same way `message` and `authorName` are, and it
    // reaches the framing as per-turn context (session-seed.takeFraming) without moving the
    // `firstClassTaskId` is UUID-gated, which is deliberate and is the SAME gate the thread lane
    // selects on (channel-agents.routeThread): the id handed to the framing is exactly the id the
    // routing keyed on, and a legacy `task-<channel>-<seq>` tag — which selects no lane and names
    // no `channel_tasks` row to read — carries nothing here. '' for every main-room turn, which
    // is byte for byte what those turns already were.
    threadId: targeting.firstClassTaskId(m),
    // THE ATTRIBUTION (incident 2026-08-01). This was `io.displayNameFor(m.authorUserId)`, and
    // an agent's posts are authored by its OWNER'S account — so the wrapper the session is fed
    // ("<name> replied in the channel…") named the OPERATOR over words a machine wrote, and an
    // agent's own echo arrived wearing the one authority the framing tells it to weigh.
    // roster.authorLabel names the actual author: the person, or the handle of the agent that
    // wrote it plus whose agent that is. Untrusted text either way, sanitized in the framing.
    authorName: roster.authorLabel(entry.channel.id, m),
    // THE INBOUND GATE HAS NOBODY TO ASK ABOUT MY OWN WORDS. Every other message through this
    // path is somebody else's, and holding it for an Accept is the point of the gate. A
    // message this operator TYPED into the channel, routed to this operator's own agent, has
    // already been approved by the act of sending it, and a card asking them to approve their
    // own sentence would make the primary flow read as broken. session-gate.enqueue reads
    // this and feeds straight through; an AUTH-HELD session still holds it, because there is
    // no agent to feed. Nothing else about the gate moves.
    //
    // TYPED, and the `humanAuthored` conjunct is what makes that word true. My own AGENT's
    // posts carry my user id too, so identity alone would hand every agent-to-agent hop INSIDE
    // A THREAD a free pass through the gate — on the one path that deliberately carries
    // agent-authored traffic, and therefore the one place where the gate is the bound that
    // keeps two of my own agents from running at each other unattended. Only a person's own
    // sentence bypasses; anything an agent wrote is gated like anybody else's words.
    selfAuthored: m.authorUserId === myUserId && engagement.humanAuthored(m),
  });
  // ACTING IS WHAT REFRESHES ENGAGEMENT, and it is refreshed LOCALLY (channel-engagement.js
  // explains why this is not a PATCH). Only a message that really reached the session
  // counts — a refusal started no work, so it is not activity.
  //
  // HUMAN-AUTHORED ONLY, and this conjunct is what makes "the window is 60 minutes, not
  // forever" true. This delivery is shared with the ADDRESSED lane, which has no author-kind
  // brake by design (agent-to-agent addressing across machines IS the product) — so a peer's
  // agent @-tagging mine refreshed my sliding window with no human at any hop, and repeating
  // that every 59 minutes held the engagement open indefinitely. The server only ever engages
  // on a human's post; the local slide now agrees with it.
  if (fed && engagement.humanAuthored(m)) engagement.noteAgentActed(entry.channel.id, row.id);
  diag('agents: routed to', named, 'seq', m.seq, fed ? 'fed' : 'REFUSED');
  return fed ? 'fed' : 'refused';
}

// ─── END CHANNEL-DELIVER-PURE ─────────────────────────────────────────────────────

module.exports = {
  agentSpec,
  wakeTeamAgent,
  selfEcho,
  deliverToAgent,
};
