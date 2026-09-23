'use strict';

// WHO ELSE IS IN THIS ROOM, AT SPAWN — the start card's ROOM ROSTER (2026-09-18, Samuel's
// ruling: *"recipients, agents… critical for agents to actually collaborate… should be
// structurally conveyed… if the agent has to search things then that becomes unreliable"*).
//
// ⚠ **THE PROBLEM IT DELETES.** An agent launched into a channel knew its own handle and its
// operator's, and nothing about the collaborators it was launched to work WITH. Picking the right
// one — "@landing-coder, yours, the Coder role" rather than a stranger's agent — cost a
// `dopl_channel(op="status")` round trip, and an agent that has to look something up before it can
// address anybody is the unreliable case the ruling names.
//
// ── TWO SOURCES, AND THE SPLIT IS THE COST ARGUMENT ─────────────────────────────────────────
//
//   SAME-OPERATOR AGENTS — this machine's own live sessions in this channel, read from the
//   registry. NO NETWORK, ever: the operator's own agents are in memory here.
//   EVERYONE ELSE — other members' agents and the human members — ONE bounded read phase, made
//   only when the channel can HAVE somebody else in it, with a hard timeout and FAIL-OPEN.
//
// ⚠ **FAIL-OPEN IS NOT A CONVENIENCE, IT IS THE CONTRACT** (`session-launch.js ›
// fetchOntologyReach` makes the same promise for the same reason): a launch must never fail, or
// even slow down noticeably, because a roster read did. Every failure — timeout, 4xx, 5xx, a
// malformed body, no auth — answers with the LOCAL half and `read: 'failed'`, and the card then
// says `others: not read` instead of implying the room is empty.
//
// 🔒 ⚠ **A SNAPSHOT, AND IT SAYS SO.** This is taken once, at spawn. Agents start and end while a
// session runs, so the card carries an "as of launch" clause and points at
// `dopl_channel(op="status")` for live truth; `session-seed.js` adds any agent that turns up later
// as the author of an inbound turn, which costs no read at all.
//
// 🔒 ⚠ **IT IS DISPLAY, NEVER DELIVERY.** F-579 deleted a channel-wide roster read because it fed
// a paragraph asking an agent to decide whether a message was for it, and its note carries the
// rule: a channel-wide roster must never become the fan-out's input. Nothing here reaches
// `session-dispatch.js`; the server still resolves recipients and the desktop still feeds only
// those.

const { diag } = require('./diag');
const { agentSlug } = require('./agent-handles');

/** ⚠ FIVE SECONDS, and the number is the launch's, not the network's. A spawn is a button click
 *  away from a human; `identity-resolve.js` picks the same bound for the same reason. */
const ROSTER_TIMEOUT_MS = 5000;

/** How many of each kind the card names before it points at the tool. ⚠ The cap is what keeps
 *  the block FIXED-SIZE in a room that grows; `prompt-framing-self.js` renders the pointer. */
const MAX_LISTED = 5;

const NAME_MAX = 80; // a display name, at the bound every other prompt label uses
const ROLE_MAX = 120; // `agent-identities/schema.ts › NameSchema`

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** An agent's @-tag: its slugged name, else its `agent-<id>` door — never the bare instance id. */
function agentHandle(name, id) {
  return agentSlug(name) || (id ? `agent-${id}` : '');
}

/**
 * THE LOCAL HALF — the operator's OWN live agents in this channel, minus the session being
 * launched. ⚠ `sessions` and `nameOf` (the rename store) are injected, so the truth table drives
 * it with no electron; a name lookup that throws costs the name, never the roster.
 */
function ownAgents(sessions, selfAgentId, nameOf) {
  const out = [];
  for (const s of sessions || []) {
    const id = text(s && s.agentId, NAME_MAX);
    if (!id || id === selfAgentId) continue;
    let name = '';
    try { name = text(nameOf ? nameOf(id) : '', NAME_MAX); } catch (_) { name = ''; }
    const ctx = (s && s.context) || {};
    out.push({
      handle: agentHandle(name, id),
      name,
      role: text(ctx.identity && ctx.identity.name, ROLE_MAX),
      mine: true,
    });
  }
  return out;
}

/**
 * THE REMOTE HALF, NARROWED AT THE BOUNDARY. Peer sessions carry `name` (the minted handle),
 * `displayName` (the operator-given name) and `userId`; a row of this operator's own is dropped
 * because the local half already has it, and holds the ROLE the projection does not carry.
 *
 * ⚠ **NO ROLE FOR A PEER, AND THAT IS THE WIRE'S SHAPE RATHER THAN A CHOICE**
 * (`types-sessions.ts › ChannelSessionState`): `identityName` is on the operator-only telemetry
 * half, so a peer's role is not ours to print. An absent role renders as an absent clause.
 */
function peerAgents(sessions, selfUserId, nameOf) {
  const out = [];
  for (const row of sessions || []) {
    if (!row || typeof row !== 'object') continue;
    const userId = text(row.userId, NAME_MAX);
    if (!userId || userId === selfUserId) continue;
    const handle = agentHandle(text(row.displayName, NAME_MAX), text(row.name, NAME_MAX));
    if (!handle) continue;
    // ⚠ ENDED SESSIONS ARE NOT IN THE ROOM. `state` is the three-word wire vocabulary; anything
    // this build does not recognise is kept, because "unknown" is not "gone".
    if (row.state === 'ended') continue;
    out.push({ handle, owner: text(nameOf(userId), NAME_MAX), mine: false });
  }
  return out;
}

/** The human members, minus the operator — the handles a post addresses a PERSON by. */
function people(members, selfUserId) {
  const out = [];
  for (const m of members || []) {
    if (!m || typeof m !== 'object') continue;
    const userId = text(m.userId, NAME_MAX);
    if (!userId || userId === selfUserId) continue;
    const name = text(m.displayName, NAME_MAX) || text(m.email, NAME_MAX);
    if (!name) continue;
    out.push({ name });
  }
  return out;
}

/**
 * Build the roster object the framing renders. PURE — every input is handed in.
 *
 * ⚠ `read` IS THREE-VALUED AND EVERY VALUE IS A DIFFERENT FACT: `'ok'` (the peer half was read),
 * `'skipped'` (nobody else can be here — a solo room), `'failed'` (we asked and did not get an
 * answer). The card says the last one out loud; collapsing it into `'ok'` would render an
 * incomplete room as a complete one, which is the failure this module is most able to cause.
 */
function buildRoster({ own = [], peers = [], members = [], read = 'skipped' } = {}) {
  const agents = [...own, ...peers];
  return {
    agents: agents.slice(0, MAX_LISTED),
    agentsMore: Math.max(0, agents.length - MAX_LISTED),
    people: members.slice(0, MAX_LISTED).map((p) => ({ handle: agentSlug(p.name), name: p.name })),
    peopleMore: Math.max(0, members.length - MAX_LISTED),
    read,
  };
}

/**
 * ONE bounded read phase for the halves this machine cannot know: the channel's own member list
 * and every member's live agent sessions in it.
 *
 * ⚠ **TWO ROUTES, ONE BUDGET, ONE ROUND OF WAITING.** The two facts live on two routes
 * (`/channels/{id}/members` and `/channels/{id}/sessions`), so they are issued CONCURRENTLY under
 * a single timeout and a single fail-open verdict — never sequentially, which would double the
 * latency a human is waiting through, and never with two independent retry stories.
 * ⚠ Each half degrades on its own: a members read that fails costs the people line and nothing
 * else.
 */
async function fetchRemote(io, { channelId, workspaceId }) {
  const get = async (path) => {
    const res = await io.apiFetch(path, { workspaceId, timeoutMs: ROSTER_TIMEOUT_MS });
    if (!res || !res.ok) throw new Error(`HTTP ${res && res.status}`);
    return res.json();
  };
  const id = encodeURIComponent(String(channelId));
  const [members, sessions] = await Promise.all([
    get(`/api/channels/${id}/members`).catch((err) => {
      diag('room-roster: members read failed —', err && err.message);
      return null;
    }),
    get(`/api/channels/${id}/sessions`).catch((err) => {
      diag('room-roster: sessions read failed —', err && err.message);
      return null;
    }),
  ]);
  return {
    members: members ? io.normalizeList(members, 'members') : null,
    sessions: sessions ? io.normalizeList(sessions, 'sessions') : null,
  };
}

/**
 * THE PRODUCER. Never throws, never refuses a launch.
 *
 * ⚠ **THE SOLO SHORT-CIRCUIT IS A COST DECISION AND A CORRECTNESS ONE.** A channel with one
 * member cannot hold another member's agent or another person to address, so the read would spend
 * a round trip to learn nothing. `memberCount` is what the caller knows; ABSENT means UNKNOWN and
 * reads — the fail-toward-answering direction, because a missing roster is the defect this exists
 * to remove.
 */
async function fetchRoomRoster(a = {}) {
  const io = a.io || require('./listener-io');
  const registry = a.registry || require('./session-registry');
  const channelId = String(a.channelId || '');
  const own = ownAgents(
    channelId ? registry.liveInChannel(channelId) : [],
    String(a.selfAgentId || ''),
    a.agentNameOf || ((id) => require('./agent-names').displayNameFor(id)),
  );
  if (!channelId || a.memberCount === 1) {
    return buildRoster({ own, read: 'skipped' });
  }
  let remote = null;
  try {
    remote = await fetchRemote(io, { channelId, workspaceId: a.workspaceId });
  } catch (err) {
    diag('room-roster: read failed —', err && err.message);
  }
  if (!remote || (remote.members === null && remote.sessions === null)) {
    return buildRoster({ own, read: 'failed' });
  }
  const selfUserId = String(a.selfUserId || '');
  const nameOf = a.nameOf || ((id) => io.displayNameFor(id));
  return buildRoster({
    own,
    peers: peerAgents(remote.sessions, selfUserId, nameOf),
    members: people(remote.members, selfUserId),
    // ⚠ A HALF THAT FAILED STILL REPORTS `failed`: the card has to say it read an incomplete
    // room, and the peer half is the one an agent would otherwise assume was empty.
    read: remote.sessions === null ? 'failed' : 'ok',
  });
}


// ── ⚠ AN AGENT THE START CARD NEVER NAMED (2026-09-18) ───────────────────────────────────────
//
// The room roster on a session's first turn is a SNAPSHOT taken at launch, and agents start after
// launches. The one moment a missing name matters is the turn that agent writes to this session,
// and everything needed to say so is already on the wire — so this costs NO read: the author's own
// handle off the message, whose it is off `authorUserId`, and the snapshot off the session's own
// context.
//
// ⚠ **PER SESSION, NOT PER MESSAGE.** Two sessions on one thread can have different snapshots (one
// launched an hour ago, one a minute ago), so the question "did YOUR card name this agent" has a
// different answer for each and is asked inside the feed loop.
// ⚠ **THE HANDLE IS THE SERVER'S `authorAgentName`, NEUTRALIZED BY THE BOUND BELOW.** A display
// name has no charset rule in this product, so it is trimmed, capped and stripped of line
// terminators before it lands in a line of our narration above the fence.
// ⚠ NOTHING HERE DECIDES DELIVERY. It runs after the wake verdict, reads no recipient field, and
// produces prose — F-579's rule that a roster must never become the fan-out's input, honoured.
function agentAuthorNote(s, m, myUserId, io) {
  if (!m || m.authorKind !== 'agent') return null;
  const handle = agentSlug(String((m && m.authorAgentName) || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80));
  if (!handle) return null;
  const roster = (s && s.context && s.context.roster) || null;
  const known = roster && Array.isArray(roster.agents)
    && roster.agents.some((a) => a && String(a.handle || '') === handle);
  if (known) return null;
  const mine = !!myUserId && String(m.authorUserId || '') === String(myUserId);
  const names = io || require('./listener-io');
  const person = String((names.displayNameFor(m && m.authorUserId)) || '').trim();
  const whose = mine ? 'one of YOUR operator\'s agents' : `${person || 'another member'}'s agent`;
  return `NEW IN THIS ROOM since your launch: @${handle} — ${whose}.`;
}

module.exports = {
  fetchRoomRoster,
  agentAuthorNote,
  // Exported for the truth table: each half is a rule, not an implementation detail.
  ownAgents,
  peerAgents,
  people,
  buildRoster,
  MAX_LISTED,
  ROSTER_TIMEOUT_MS,
};
