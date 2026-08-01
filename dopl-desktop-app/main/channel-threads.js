// channel-threads.js — WHO IS IN A BREAKOUT ROOM, on this machine's authority.
//
// THE LAW says it in one sentence (packages/mcp-server/src/tools/channel-description.ts):
// "Inside a thread everyone in it hears everything: no tagging between participants." Until
// now that sentence was false on the desktop. A thread-tagged, UNADDRESSED post reached
// `routeAddressedAgent`, found no `to_agent_ids`, fell to the engagement lane (which refuses
// agent authors, correctly, because in the MAIN ROOM that is the loop brake) and then to
// classify, which returned 'fyi'. So the moment two agents opened a breakout room to work in,
// they went deaf to each other inside it — the exact opposite of what the room is for.
//
// WHAT MAKES A THREAD DIFFERENT FROM THE ROOM, and why the brake is not weakened by this.
// In the main room, an unaddressed agent-authored post has NO fence around it: every agent in
// the channel would take it, and every reply is itself an unaddressed agent-authored post, so
// the thing runs forever. A thread has a PARTICIPANT SET — a bounded list, curated by a human
// (only the creator, the target, or an existing human participant may add to it; there is no
// self-join), stored server side and readable only over an authenticated call. Being in it is
// the standing consent, and it is the same fence the SERVER enforces on writes
// (service-writes-metadata.mayWriteThread). So the rule this module implements is narrow:
// inside a thread I am a participant of, my agent hears the thread. Outside one, nothing
// changes at all.
//
// WHERE THE FACTS COME FROM, and why not off the message. The server stamps a lot onto a post
// (`author_agent_id`, `to_agent_ids`, `taskMode`, `taskCreatedBy`, `taskTarget`) and stamps
// NOTHING about the participant set. That is lucky, because a participant list riding on a
// message would be a claim rather than a fact, and this is a routing decision that starts work
// on this machine. It is read instead from `GET /api/channels/<id>/tasks/<threadId>`, whose
// `task.participants` array is the join table `channel_task_participants`
// (migration 20260731130000) — `kind` 'user' | 'agent', with `agentId` a `channel_agents.id`.
// OWNERSHIP IS STILL NOT TAKEN FROM THERE: a participant row says an agent is in the thread,
// and the authenticated ROSTER (channel-roster.js) is what says the agent is MINE.
//
// F-072: BOUNDED, CACHED, SINGLE-FLIGHT. This read sits on the message path, so it is the
// exact shape of a read storm if written naively. Three bounds:
//   TTL        a set is reused for CACHE_TTL_MS. `channel_task_participants` is deliberately
//              NOT in the realtime publication, so there is no doorbell to invalidate on;
//              five minutes matches the reconcile cadence, and the cost of being stale is
//              bounded in the safe direction (see below).
//   BACKOFF    a FAILED read is remembered too, for FAIL_BACKOFF_MS, so a 500 or a pre-deploy
//              404 cannot turn every message in a busy thread into another request.
//   CAP        a plain LRU on (channel, thread), pruned oldest-first on write.
// SINGLE-FLIGHT per thread: two messages arriving together join one read.
//
// WHAT A STALE SET COSTS, in both directions. A participant added since the last read is not
// heard until the entry ages out (a delay, never a wrong delivery). A participant REMOVED
// since the last read may still be fed for up to the TTL — which is why the TTL is minutes and
// not hours, and why it is worth saying plainly that this cache is a routing convenience and
// NOT the security boundary: the server refuses the agent's own write the moment it is out of
// the thread, so the worst case is a turn that runs and cannot post its answer.

const io = require('./listener-io'); // the listener's authenticated fetch (cookie + ws header)
const { diag } = require('./diag');

// ─── BEGIN CHANNEL-THREADS-PURE (injectable; unit-tested via source extraction) ────
// Every dependency is either this block's own state or one of the two module-top requires
// referenced as a FREE VARIABLE — io, diag. The truth tables slice it whole and drive the
// REAL participant policy with a fake standing in for HTTP.

const CACHE_TTL_MS = 5 * 60 * 1000; // a good set is reused this long
const FAIL_BACKOFF_MS = 30 * 1000; // …and a failed read is not retried for this long
const CACHE_CAP = 100; // (channel, thread) pairs held at once

const cache = new Map(); // `${channelId}:${threadId}` -> { at, rows } — rows null == read failed
const inFlight = new Map(); // the same key -> the read in progress

function threadKey(channelId, threadId) {
  return String(channelId || '') + ':' + String(threadId || '');
}

// Remember a read (good or failed) and prune. Insertion order is age order, so one pass from
// the front drops whatever is over the cap.
function remember(key, rows, nowMs) {
  cache.delete(key);
  cache.set(key, { at: Number(nowMs) || Date.now(), rows: rows });
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_CAP) break;
    cache.delete(oldest);
  }
}

// PURE-ish: the cached answer for one thread, or undefined when there is nothing usable.
// A FAILED read (rows null) is honoured for FAIL_BACKOFF_MS and a good one for CACHE_TTL_MS,
// which is the whole difference between the two.
function cached(key, nowMs) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const age = (Number(nowMs) || Date.now()) - hit.at;
  const ttl = hit.rows === null ? FAIL_BACKOFF_MS : CACHE_TTL_MS;
  if (age < 0 || age > ttl) return undefined;
  return hit.rows;
}

// PURE: the ROSTER ROWS of my own agents that participate in this thread, in roster order.
//
// TWO SOURCES, DELIBERATELY. `participants` says who is in the thread (server truth, but it
// is a list of ids and nothing else); the ROSTER says whose agent each id is and whether it
// is still live. Ownership never comes off the participant row, for the same reason it never
// comes off a message: a routing decision that starts work here answers only to the
// authenticated roster read.
function myAgentParticipants(participants, rows, myUserId) {
  const out = [];
  if (!myUserId) return out;
  const inThread = new Set();
  for (const p of participants || []) {
    if (!p || p.kind !== 'agent') continue;
    const id = typeof p.agentId === 'string' ? p.agentId.trim() : '';
    if (id) inThread.add(id);
  }
  if (!inThread.size) return out;
  for (const row of rows || []) {
    if (row && inThread.has(row.id) && row.ownerUserId === myUserId) out.push(row);
  }
  return out;
}

// The authenticated read. Returns the participant array, or NULL when the thread could not be
// read — the null is load-bearing everywhere it travels: unknown participation routes NOBODY,
// which leaves the message on exactly the path it took before this module existed.
async function fetchParticipants(entry, threadId) {
  let res;
  try {
    res = await io.apiFetch(`/api/channels/${entry.channel.id}/tasks/${threadId}`, {
      workspaceId: entry.workspaceId,
      timeoutMs: 15000,
    });
  } catch (err) {
    diag('threads: participant fetch error', err && err.message);
    return null;
  }
  if (!res.ok) {
    diag('threads: participant read', res.status, 'thread', String(threadId).slice(0, 8));
    return null;
  }
  try {
    const data = await res.json();
    const task = (data && data.task) || null;
    // A server that predates the join table sends no `participants` at all. That is NOT an
    // empty set — an empty set would say "this thread has no participants", which for a
    // pair-gated thread is true and for an unmigrated server is a guess. Both answer the same
    // way here (nobody is routed), but only one of them is a fact, so the absent field is
    // reported as unknown.
    if (!task || !Array.isArray(task.participants)) return null;
    return task.participants;
  } catch (err) {
    diag('threads: participant parse error', err && err.message);
    return null;
  }
}

// The cached, single-flight participant set for one thread. `null` means "not known right
// now" and every caller treats it as "route nobody".
function participantsFor(entry, threadId, nowMs) {
  const key = threadKey(entry && entry.channel && entry.channel.id, threadId);
  const hit = cached(key, nowMs);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = inFlight.get(key);
  if (running) return running;
  const p = fetchParticipants(entry, threadId)
    .catch(() => null)
    .then((rows) => {
      remember(key, rows, nowMs);
      return rows;
    })
    .finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

// ─── END CHANNEL-THREADS-PURE ─────────────────────────────────────────────────────

module.exports = {
  CACHE_TTL_MS,
  FAIL_BACKOFF_MS,
  CACHE_CAP,
  myAgentParticipants,
  fetchParticipants,
  participantsFor,
};
