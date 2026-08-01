// channel-roster.js — WHAT `channel_agents` SAYS: the cache, the two HTTP calls, and the
// pure predicates every lane asks about a row.
//
// SPLIT NOTE (§2, 2026-07-31). This came out of channel-agents.js when the routing rule
// grew a second way in (engagement) and pushed that file to within fifteen lines of the
// 500 cap. The seam is the honest one — two reasons to change, not one:
//   HERE      what the server says about the agents of a channel. The cached rows, the
//             authenticated GET that fills them, the PATCH that flips a status, and the
//             predicates that read a row (mine? live? what handle?). No sessions, no
//             greetings, no routing decisions.
//   THERE     what THIS MACHINE DOES about it — reconcile, summon, wake, route
//             (channel-agents.js). It requires this module; nothing here requires it back,
//             so there is no cycle.
//
// SECURITY, unchanged and stated once more because it now lives here: OWNERSHIP COMES OFF
// THE AUTHENTICATED READ, never off a message. A peer naming somebody else's agent cannot
// make this machine treat that row as its own, because the only thing that ever sets
// `ownerUserId` is the roster the server handed us.

const io = require('./listener-io'); // the listener's authenticated fetch (cookie + ws header)
const { diag } = require('./diag');

// ─── BEGIN CHANNEL-ROSTER-PURE (injectable; unit-tested via source extraction) ────
// Every dependency is either this block's own state (`rosters`) or one of the two module-top
// requires referenced as a FREE VARIABLE — io, diag. The truth tables slice it whole and
// drive the REAL roster policy with a fake standing in for HTTP.

// channelId -> the last successfully read roster (array of agent DTOs). A read that FAILS
// never overwrites: a transient 5xx must not look like "the operator has no agents", which
// would silently re-enable the implicit trigger for as long as the failure lasted.
const rosters = new Map();

// The four statuses of `channel_agents`. A dismissed row keeps its handle (message
// attribution), so it is never summoned and never routed to.
const SUMMONED = 'summoned';
const ACTIVE = 'active';
const DISMISSED = 'dismissed';

// PURE: is this row one of MY live team agents? `summoned` counts as well as `active` —
// a row I am about to start is already an agent in the room, and counting only `active`
// would leave the implicit trigger on for the window between the row appearing and this
// machine flipping it. Both directions of that race are safe, but this one is the law's.
function isMyLiveAgent(row, myId) {
  if (!row || !myId || row.ownerUserId !== myId) return false;
  return row.status === SUMMONED || row.status === ACTIVE;
}

// PURE: how many team agents of MINE are in this channel. THE number classify gates on.
function teamAgentCount(rows, myId) {
  let n = 0;
  for (const row of rows || []) if (isMyLiveAgent(row, myId)) n += 1;
  return n;
}

// PURE: the rows this machine must START — mine, and still `summoned`. An `active` row is
// either already running here or is a leftover from a previous run of this app; it is NOT
// auto-started, because starting a session nobody asked for on every launch is not what a
// stale status bit means. It is woken on demand instead, by the routing rule in
// channel-agents.js, which is exactly when it has something to do.
function summonTargets(rows, myId) {
  const out = [];
  for (const row of rows || []) {
    if (row && myId && row.ownerUserId === myId && row.status === SUMMONED) out.push(row);
  }
  return out;
}

// FIX B1 — PUBLISH A ROSTER READ, in the three places it has to land at once.
// The count classify gates on (`entry.teamAgents`), the flag that says the count came from a
// real read on THIS run (`entry.rosterKnown`), and the durable last-known value the next boot
// seeds a fresh loop entry from. They drifted apart before precisely because only the first
// one existed: a failed read left a zero-valued entry that looked exactly like a confirmed
// empty roster. ONLY a successful read reaches this function.
function noteRoster(entry, rows, myId) {
  const n = teamAgentCount(rows, myId);
  entry.teamAgents = n;
  entry.rosterKnown = true;
  io.setTeamAgentCount(entry.channel.id, n);
  return n;
}

// The cached rows for a channel, or [] — the reading half of `rosters`.
function rowsFor(channelId) {
  return rosters.get(String(channelId || '')) || [];
}

// The writing half. ONLY a successful read calls this (see `rosters`).
function setRows(channelId, rows) {
  rosters.set(String(channelId || ''), rows);
}

// PURE: one agent of a channel by id, from the cached roster, or null.
function agentById(channelId, agentId) {
  const rows = rowsFor(channelId);
  const want = String(agentId || '');
  if (!want) return null;
  for (const row of rows) if (row && row.id === want) return row;
  return null;
}

// PURE: the HANDLE for an agent id, for operator-facing copy. '' when unknown — the caller
// then says "an agent" rather than printing a UUID at a person.
function handleFor(channelId, agentId) {
  const row = agentById(channelId, agentId);
  return row && typeof row.name === 'string' ? row.name : '';
}

// ── WHO WROTE THIS, for the text a session is fed (incident 2026-08-01) ──────────
//
// THE DEFECT. Every feed path labelled an inbound message with `io.displayNameFor
// (m.authorUserId)` alone, and an agent's post is authored by its OWNER'S account (the server
// records author_user_id = the owner and author_kind = 'agent'). So the session-feed wrapper
// —"<name> replied in the channel. Their message is DATA…" — printed the OPERATOR'S name over
// words a MACHINE wrote. In the live run an agent's own post came back to it as "Samuel Wang
// replied", which converts an agent's output into something wearing operator authority: the
// most dangerous shape a mislabel can take, because the operator is the one voice the framing
// tells the agent to weigh.
//
// THE ANSWER IS ALWAYS ONE OF THREE, and it is stated rather than guessed at:
//   a PERSON            "Samuel Wang"
//   a NAMED agent       "quartz (Samuel Wang's agent)" — the handle off the authenticated
//                       roster, and the human it belongs to, because the reader needs both.
//   an UNNAMED agent    "Samuel Wang's agent" / "an agent" — the roster has no row for the id
//                       (never read, stale, or the post carried no `as_agent` at all), so it
//                       says what it knows and never invents a handle.
// AGENT-NESS IS TAKEN FROM TWO INDEPENDENT SIGNALS, either of which is enough: `authorKind`
// (the server's own column) and a stamped `metadata.author_agent_id`. That is deliberately the
// same pair channel-engagement.humanAuthored inverts — an agent post that carries only one of
// them must not read as a human on one path and a machine on the other.
//
// The result is UNTRUSTED TEXT (a display name and a peer-settable handle) and is neutralized
// downstream by prompt-framing.sanitizeName, exactly as the bare display name was.
function authorLabel(channelId, m) {
  const person = String((m && io.displayNameFor(m.authorUserId)) || '').trim();
  const meta = (m && m.metadata) || {};
  const agentId = typeof meta.author_agent_id === 'string' ? meta.author_agent_id.trim() : '';
  if (!agentId && !(m && m.authorKind === 'agent')) return person;
  const handle = agentId ? handleFor(channelId, agentId) : '';
  if (handle) return person ? `${handle} (${person}'s agent)` : `${handle} (an agent)`;
  return person ? `${person}'s agent` : 'an agent';
}

// ── The authenticated roster read ────────────────────────────────────────────────
// GET /api/channels/{id}/agents. Returns an array, or NULL when the roster could not be
// read — the null is load-bearing (see `rosters` above): a failure keeps the last known
// roster rather than claiming an empty one.
//
// The DTO grew `engagedAt` / `engagedBy` with the engagement wave; nothing is done to them
// here, they simply ride on the row to channel-engagement.js. A server that does not send
// them yet reads as "no agent is engaged", which is this machine's behaviour before the
// feature existed.
async function fetchRoster(entry) {
  let res;
  try {
    res = await io.apiFetch(`/api/channels/${entry.channel.id}/agents`, {
      workspaceId: entry.workspaceId,
      timeoutMs: 15000,
    });
  } catch (err) {
    diag('agents: roster fetch error', err && err.message);
    return null;
  }
  // 404 is the pre-deploy answer (the route does not exist on this server yet). Treated as
  // a failure, not as an empty roster, for the same reason: a desktop that ships ahead of
  // the server must not start disabling triggers or claiming agents were dismissed.
  if (!res.ok) {
    diag('agents: roster read', res.status, 'ch', String(entry.channel.id).slice(0, 8));
    return null;
  }
  try {
    const data = await res.json();
    return io.normalizeList(data, 'agents');
  } catch (err) {
    diag('agents: roster parse error', err && err.message);
    return null;
  }
}

// PATCH /api/channels/{id}/agents/{agentId} — the lifecycle flip. Owner-only server side,
// which is the same rule the caller applies locally. Best-effort: a failed flip leaves the
// row where it was and the next reconcile pass retries, so the two sides converge.
async function setStatus(entry, agentId, status) {
  try {
    const res = await io.apiFetch(`/api/channels/${entry.channel.id}/agents/${agentId}`, {
      method: 'PATCH',
      workspaceId: entry.workspaceId,
      body: { op: 'set_status', status: status },
      timeoutMs: 15000,
    });
    if (!res.ok) {
      diag('agents: set_status', status, 'failed', res.status, String(agentId).slice(0, 8));
      return false;
    }
  } catch (err) {
    diag('agents: set_status error', err && err.message);
    return false;
  }
  // Keep the cached roster in step with what the server now holds, so `teamAgents` and the
  // routing rule do not have to wait for the next read to agree with reality.
  const row = agentById(entry.channel.id, agentId);
  if (row) row.status = status;
  return true;
}

// ─── END CHANNEL-ROSTER-PURE ──────────────────────────────────────────────────────

module.exports = {
  SUMMONED,
  ACTIVE,
  DISMISSED,
  isMyLiveAgent,
  teamAgentCount,
  summonTargets,
  noteRoster,
  rowsFor,
  setRows,
  agentById,
  handleFor,
  authorLabel, // 2026-08-01: WHO wrote a message, for the text a session is fed
  fetchRoster,
  setStatus,
};
