// channel-agents.js — the desktop half of `channel_agents`: MY summons, and MY routing.
//
// A `channel_agents` row is a first-class named entity in a channel, owned by ONE member and
// running on THAT member's machine. This module is what makes the second half true on this
// machine: it watches the roster of every channel the listener watches, starts a TEAM session
// for each row this operator owns, and routes an @-addressed message into the session of the
// agent it names. Rows owned by anybody else are read-only here — they are handles for
// attribution and nothing more, because their sessions live on their owners' Macs.
//
// ── HOW A SUMMON IS DETECTED (the mechanism, stated once) ────────────────────────────
// TWO paths, one body of work, no new polling loop:
//   1. REALTIME DOORBELL. `channel_agents` IS in the `supabase_realtime` publication
//      (migration 20260731120000) and its RLS SELECT policy mirrors `channel_messages`, so
//      the listener's existing WebSocket carries it on a per-workspace channel of its own
//      (realtime.js addAgentChannel — deliberately NOT a second binding on the message
//      channel, since Realtime fails a whole channel when any one binding is refused). The
//      payload is used exactly as a message push is: a DOORBELL carrying a routing key and
//      nothing else (realtime.js "WAKE-ONLY TRUST MODEL"). A push means "this channel's
//      roster changed", and the authenticated GET below is what actually reads it.
//   2. THE RECONCILE PASS. channel-listener.reconcile already runs at start, every 5 minutes,
//      on wake, and on sign-in; it calls reconcileAll() at the end of each pass. That is the
//      backstop for a machine whose push is unhealthy (the breaker is open, no credential,
//      an errored ws sub) and for the boot case, where the roster has to be read once before
//      any doorbell can ring.
// Both funnel into reconcileChannel(), which is SINGLE-FLIGHT per channel: a doorbell that
// arrives while a read is in flight joins it instead of starting a second one (F-072 — no
// read-triggered storm).
//
// ── WHAT THE ROSTER IS FOR, BEYOND SUMMONING ────────────────────────────────────────
//   - `entry.teamAgents` — the count of MY agents in this channel. targeting.classify reads
//     it to disable the implicit 2-member trigger while agents are present ("address to
//     act"). It rides on the loop ENTRY, not on `entry.channel`, because reconcile replaces
//     the channel DTO wholesale on every pass. FIX B1 made it a TRI-STATE: the entry is
//     SEEDED at creation from the durable last-known count (listener-io.getTeamAgentCount)
//     and `entry.rosterKnown` says whether a read on THIS run has confirmed it, so a channel
//     whose roster cannot be read right now keeps the law armed instead of reading as zero.
//   - handle resolution — an agent-authored message carries `metadata.author_agent_id`, and
//     the escalation notification has to name a HANDLE, not a UUID. The roster covers every
//     agent of the channel, peers' included, so any id in a message can be named.
//
// SECURITY: nothing here trusts a message to tell it who owns an agent. Ownership comes from
// the authenticated roster read, and the routing rule below refuses any `to_agent_id` that is
// not one of THIS operator's own rows — a peer naming somebody else's agent cannot make this
// machine start a session.

const io = require('./listener-io'); // the listener's authenticated fetch (cookie + ws header)
const targeting = require('./targeting');
const settings = require('./settings');
const sessionEngine = require('./session-engine');
const { diag } = require('./diag');

// ─── BEGIN CHANNEL-AGENTS-PURE (injectable; unit-tested via source extraction) ────
// EVERY dependency in this block is either its own module state (`rosters`, `inFlight`,
// `lastIdentity`) or one of the module-top requires referenced as a FREE VARIABLE — io,
// targeting, settings, sessionEngine, diag. That is the session-dispatch idiom: the truth
// tables slice this block whole and drive the REAL roster policy, the REAL summon flow and
// the REAL routing rule with fakes standing in for HTTP and for the host-bound engine, so
// what is tested is what ships.

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
// stale status bit means. It is woken on demand instead, by the routing rule below, which
// is exactly when it has something to do.
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

// PURE: one agent of a channel by id, from the cached roster, or null.
function agentById(channelId, agentId) {
  const rows = rosters.get(String(channelId || '')) || [];
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

// ── The authenticated roster read ────────────────────────────────────────────────
// GET /api/channels/{id}/agents. Returns an array, or NULL when the roster could not be
// read — the null is load-bearing (see `rosters` above): a failure keeps the last known
// roster rather than claiming an empty one.
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
// which is the same rule this module applies locally. Best-effort: a failed flip leaves the
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
  // routing rule below do not have to wait for the next read to agree with reality.
  const row = agentById(entry.channel.id, agentId);
  if (row) row.status = status;
  return true;
}

// ── Summon → spawn → status ──────────────────────────────────────────────────────
// One summoned row becomes a TEAM session (a room-bound parked shell — session-team.js),
// and ONLY a session that really opened flips the row to `active`. A refused summon leaves
// it `summoned`, so the next pass tries again and the server never believes an agent is
// running on a machine that declined to start it.
async function startSummoned(entry, row, myId) {
  const res = await sessionEngine.summonTeamSession({
    channelId: entry.channel.id,
    workspaceId: entry.workspaceId,
    agentId: row.id,
    agentName: row.name,
    ownerName: io.displayNameFor(myId),
    channelName: entry.channel.name,
    toolProfile: targeting.resolveToolProfile(entry.channel),
  });
  if (res && res.sessionId) {
    await setStatus(entry, row.id, ACTIVE);
    return true;
  }
  diag('agents: summon not started', String(row.name || row.id).slice(0, 24), (res && res.skipped) || 'unknown');
  return false;
}

// ── Reconcile one channel's roster ───────────────────────────────────────────────
// SINGLE-FLIGHT per channel: the doorbell and the 5-minute pass can land together, and two
// concurrent reads would race on the summon decision (both would see the same `summoned`
// row and both would try to start it). The second caller awaits the first.
const inFlight = new Map();

function reconcileChannel(entry, myId) {
  if (!entry || !entry.channel || !entry.channel.id) return Promise.resolve(false);
  const id = entry.channel.id;
  const running = inFlight.get(id);
  if (running) return running;
  const p = reconcileChannelInner(entry, myId).finally(() => {
    if (inFlight.get(id) === p) inFlight.delete(id);
  });
  inFlight.set(id, p);
  return p;
}

async function reconcileChannelInner(entry, myId) {
  if (!myId) return false; // fail closed: with no identity we cannot tell whose agents these are
  const rows = await fetchRoster(entry);
  if (rows === null) {
    // FIX B1: the roster is UNKNOWN, not empty. `entry.teamAgents` keeps whatever it was
    // seeded with (the durable last-known count) and `rosterKnown` stays false, so the
    // classifier fails CLOSED toward the law and the dispatcher can say so in the log.
    diag('agents: roster unknown', String(entry.channel.id).slice(0, 8), 'keeping last known', Number(entry.teamAgents) || 0);
    return false; // keep the last known roster (see `rosters`)
  }
  rosters.set(entry.channel.id, rows);
  noteRoster(entry, rows, myId);
  const targets = summonTargets(rows, myId);
  if (!targets.length) return true;
  diag('agents: summoning', targets.length, 'in', String(entry.channel.id).slice(0, 8));
  for (const row of targets) {
    // Serial on purpose: each summon takes a window slot, and starting four at once would
    // race the shared budget instead of filling it in a defined order.
    await startSummoned(entry, row, myId);
  }
  noteRoster(entry, rosters.get(entry.channel.id) || rows, myId);
  return true;
}

// Every watched channel, from the listener's own loop map. Called at the END of a reconcile
// pass — fire-and-forget, so a slow roster read can never hold up channel watching.
function reconcileAll(loops, myId) {
  lastIdentity = myId || null;
  for (const entry of (loops || new Map()).values()) {
    reconcileChannel(entry, myId).catch((err) => diag('agents: reconcile error', err && err.message));
  }
}

// The realtime doorbell (a `channel_agents` INSERT for a channel we watch). Re-reads that
// one roster. `lastIdentity` is the operator id the last reconcile pass resolved: a doorbell
// that rings before the first pass has nobody to attribute rows to and is simply dropped —
// the pass itself is moments away and will read the same roster.
let lastIdentity = null;

function wakeChannel(entry) {
  if (!entry || !lastIdentity) return;
  reconcileChannel(entry, lastIdentity).catch((err) => diag('agents: wake error', err && err.message));
}

// ── THE ROUTING RULE: an @-addressed message reaches THAT agent's session ─────────
//
// Checked BEFORE every other route (listener-messages.js), because addressing is the act
// verb: a message that names one of my agents belongs to that agent's session and to
// nothing else — not to a thread-keyed pair session that happens to be live, and not to the
// consent gate, which would open a second run against a message already spoken for.
//
// ── FIX S2 — FOUR VERDICTS, BECAUSE A BOOLEAN CONFLATED TWO DIFFERENT ANSWERS ────
// This used to return a bare boolean and the caller read EVERY false as "not mine, carry
// on". So a message addressed to one of MY agents that this machine REFUSED — a dismissed
// row, a roster it could not read, a window cap, a binding refusal, a full inbound queue —
// fell through to classify, which sees the OWNER BRIDGE's `to_user_id = me` and returns
// 'trigger': a consent card and a pair-bound ASSIST spawn, standing in for the named agent.
// A dismissed agent's message therefore started a session, which is the exact opposite of
// what the dismissal means and of what this file's own comment claims.
//
//   ''           NOT THIS LANE — fall through, unchanged and correct. Window-mode off, not
//                a message, my own message, no `to_agent_id`, or an agent this operator does
//                not own (somebody else's agent, on somebody else's machine; ownership comes
//                off the authenticated roster, never off the message).
//   'fed'        delivered into that agent's own session.
//   'dismissed'  the row is retired. It keeps its handle for attribution and starts NOTHING;
//                the operator is told passively (listener-messages -> task-notify), because
//                somebody addressed an agent that is gone.
//   'refused'    mine, but this machine could not run it now. It also starts NOTHING — a
//                pair session is not a substitute for the agent that was named — and the
//                reason is always in the diag.
// Every verdict but '' is TRUTHY, so the caller short-circuits on all three.
async function routeAddressedAgent(entry, m, myUserId) {
  if (!settings.getWindowMode()) return '';
  if (!m || m.kind !== 'message') return '';
  if (!myUserId || m.authorUserId === myUserId) return '';
  const toAgent = targeting.metaStr(m, 'to_agent_id');
  if (!toAgent) return '';
  const row = agentById(entry.channel.id, toAgent);
  if (!row) return unroutableOwnAgent(m, myUserId, toAgent);
  if (row.ownerUserId !== myUserId) return '';
  const named = String(row.name || row.id).slice(0, 24);
  if (row.status === DISMISSED) {
    diag('agents: addressed a DISMISSED row', named, 'seq', m.seq, '- nothing started');
    return 'dismissed';
  }
  if (row.status !== SUMMONED && row.status !== ACTIVE) {
    diag('agents: addressed row not live', named, String(row.status || '?'), '- nothing started');
    return 'refused';
  }
  const slot = { channelId: entry.channel.id, agentId: row.id };
  if (!sessionEngine.hasLiveSession(slot)) {
    // Addressed with no session on this machine: the agent's row exists, so start it now
    // and put it back to `active`. This is the same summon path, reached from the other
    // direction — a restart, an evicted shell, or a peer addressing an agent whose row
    // arrived while push was down.
    if (!(await startSummoned(entry, row, myUserId))) {
      diag('agents: could not start', named, 'for seq', m.seq, '- nothing started');
      return 'refused';
    }
    const cached = rosters.get(entry.channel.id);
    if (cached) noteRoster(entry, cached, myUserId);
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
    authorName: io.displayNameFor(m.authorUserId),
  });
  diag('agents: addressed', named, 'seq', m.seq, fed ? 'fed' : 'REFUSED');
  return fed ? 'fed' : 'refused';
}

// An id that names no agent of this channel's CACHED roster. Usually that is a peer's agent
// or a stale id, and falling through is right — the message is not this lane's.
//
// One case is not: the OWNER BRIDGE. The server stamps `to_user_id` = the addressed agent's
// OWNER, and that takes precedence over any explicit `toUserId` the caller sent
// (service-writes-metadata resolvePostMetadata), so a message carrying BOTH a `to_agent_id`
// and `to_user_id === me` names an agent of MINE by construction — the server validated the
// id against this channel before it stamped anything. Not finding the row therefore means
// this machine's roster is missing or stale (never read yet, a read that failed, or a row
// created since the last pass), not that the agent belongs to somebody else.
//
// Falling through there is the B1 failure in miniature: classify sees `to_user_id === me`,
// returns 'trigger', and a pair ASSIST session answers a message meant for a named agent. So
// it fails CLOSED. The reconcile pass (and the realtime doorbell) reads the row moments
// later, and the peer's next message routes normally.
function unroutableOwnAgent(m, myUserId, toAgent) {
  if (targeting.metaStr(m, 'to_user_id') !== myUserId) return ''; // somebody else's agent
  diag('agents: addressed', String(toAgent).slice(0, 8), 'is MINE but not on the cached roster - nothing started');
  return 'refused';
}

// ─── END CHANNEL-AGENTS-PURE ──────────────────────────────────────────────────────

module.exports = {
  isMyLiveAgent,
  teamAgentCount,
  summonTargets,
  agentById,
  handleFor,
  fetchRoster,
  setStatus,
  reconcileChannel,
  reconcileAll,
  wakeChannel,
  routeAddressedAgent,
};
