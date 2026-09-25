'use strict';

// WHO ELSE IS IN THIS ROOM, AT SPAWN — the start card's roster, so an agent can address its
// collaborators without a lookup. Own agents come from this machine's registry (no network); peers'
// agents and the human members from ONE bounded read, only when the room can hold somebody else.
// FAIL-OPEN: a launch never fails or stalls on a roster read (failure → the local half + `read:
// 'failed'`). A SNAPSHOT (the card says "as of launch"), and DISPLAY ONLY: it must never feed
// delivery (F-579); the server resolves recipients.

const { diag } = require('./diag');
const { agentSlug } = require('./agent-handles');

// The launch's budget, not the network's (a human is waiting on the click).
const ROSTER_TIMEOUT_MS = 5000;

// Per kind; keeps the block fixed-size (`prompt-framing-self.js` renders the pointer past it).
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
 * The operator's OWN live agents here, minus the one being launched. `sessions` and `nameOf` (the
 * rename store) are injected; a name lookup that throws costs the name, never the roster.
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
 * Other members' live agents from the projection (own rows are the local half's). No role: the
 * wire carries none for a peer (`identityName` is on the operator-only half).
 */
function peerAgents(sessions, selfUserId, nameOf) {
  const out = [];
  for (const row of sessions || []) {
    if (!row || typeof row !== 'object') continue;
    const userId = text(row.userId, NAME_MAX);
    if (!userId || userId === selfUserId) continue;
    const handle = agentHandle(text(row.displayName, NAME_MAX), text(row.name, NAME_MAX));
    if (!handle) continue;
    // Ended sessions are not in the room; an unrecognised state is kept (unknown is not gone).
    if (row.state === 'ended') continue;
    out.push({ handle, owner: text(nameOf(userId), NAME_MAX), mine: false });
  }
  return out;
}

/** The human members, minus the operator. */
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
 * The roster the framing renders (pure). `read` is three facts: `ok`, `skipped` (a solo room) and
 * `failed` (asked, no answer) — the card says the last out loud rather than implying an empty room.
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

/** Members and sessions CONCURRENTLY under one timeout; each half degrades on its own. */
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
 * The producer; never throws, never refuses a launch. A known solo room (`memberCount === 1`) skips
 * the read; an absent count reads (unknown is not solo).
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
    // A failed peer half still says `failed`: that is the half an agent would assume was empty.
    read: remote.sessions === null ? 'failed' : 'ok',
  });
}

const authorHandle = (m) => agentSlug(String((m && m.authorAgentName) || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80));
const ownAuthor = (m, myUserId) => !!myUserId && String((m && m.authorUserId) || '') === String(myUserId);

/**
 * WHO A REPLY TO `m` IS ADDRESSED TO — the `to=` the reply call carries (`prompt-framing.js ›
 * replyCall`): one of MY agents by its @handle (the only agent `to=` reaches), anyone else by the
 * posting account's user id — a peer's agent included, since no handle reaches another member's
 * agent. Never an email. '' when my agent's name is unknown, so no wrong address is handed over.
 */
function authorAddress(m, myUserId) {
  if (!m || !m.authorUserId) return '';
  if (m.authorKind === 'agent' && ownAuthor(m, myUserId)) {
    const handle = authorHandle(m);
    return handle ? `@${handle}` : '';
  }
  return String(m.authorUserId);
}

/**
 * An agent the launch snapshot never named introduces itself on the turn it writes to this session
 * — per session, costing no read. The author's display name is slugged, capped and stripped of line
 * breaks before it lands above the fence. Prose only; it decides no delivery.
 */
function agentAuthorNote(s, m, myUserId, io) {
  if (!m || m.authorKind !== 'agent') return null;
  const handle = authorHandle(m);
  if (!handle) return null;
  const roster = (s && s.context && s.context.roster) || null;
  const known = roster && Array.isArray(roster.agents)
    && roster.agents.some((a) => a && String(a.handle || '') === handle);
  if (known) return null;
  const mine = ownAuthor(m, myUserId);
  const names = io || require('./listener-io');
  const person = String((names.displayNameFor(m && m.authorUserId)) || '').trim();
  const whose = mine ? 'one of YOUR operator\'s agents' : `${person || 'another member'}'s agent`;
  return `NEW IN THIS ROOM since your launch: @${handle}, ${whose}.`;
}

module.exports = {
  fetchRoomRoster,
  agentAuthorNote,
  authorAddress,
  ownAgents,
  peerAgents,
  people,
  buildRoster,
  MAX_LISTED,
  ROSTER_TIMEOUT_MS,
};
