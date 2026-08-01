// channel-agents.js — the desktop half of `channel_agents`: MY summons, and MY routing.
//
// A `channel_agents` row is a first-class named entity in a channel, owned by ONE member and
// running on THAT member's machine. This module is what makes the second half true on this
// machine: it watches the roster of every channel the listener watches, GREETS THE ROOM as
// each newly summoned row this operator owns (no window, no session — the chat is where an
// arrival is visible), and routes an @-addressed message into the session of the agent it
// names, opening that session on demand. Rows owned by anybody else are read-only here — they
// are handles for attribution and nothing more, because their sessions live on their owners'
// Macs.
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
// the authenticated roster read (channel-roster.js), and the routing rule below refuses any
// addressed agent id that is not one of THIS operator's own rows — a peer naming somebody
// else's agent cannot make this machine start a session.
//
// SPLIT NOTE (§2, 2026-07-31): the roster itself — the cache, the GET, the PATCH and the
// predicates that read a row — moved to channel-roster.js when the routing rule grew its
// second way in. This file is what the machine DOES; that one is what the server SAID.

const io = require('./listener-io'); // the listener's authenticated fetch (cookie + ws header)
const targeting = require('./targeting');
const settings = require('./settings');
const sessionEngine = require('./session-engine');
const engagement = require('./channel-engagement'); // WHO an untagged message is for
const roster = require('./channel-roster'); // WHAT the server says about this channel's agents
const threads = require('./channel-threads'); // WHO is in a breakout room
const { diag } = require('./diag');

// ─── BEGIN CHANNEL-AGENTS-PURE (injectable; unit-tested via source extraction) ────
// EVERY dependency in this block is either its own module state (`inFlight`, `lastIdentity`)
// or one of the module-top requires referenced as a FREE VARIABLE — io, targeting, settings,
// sessionEngine, engagement, roster, diag. That is the session-dispatch idiom: the truth
// tables slice this block whole and drive the REAL summon flow and the REAL routing rule with
// fakes standing in for HTTP and for the host-bound engine, so what is tested is what ships.

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

// ── Summon → GREET THE CHANNEL → status ──────────────────────────────────────────
// A summoned row of mine announces itself IN THE ROOM (session-greeting.js). No window is
// opened, no window budget is spent and no session is started: the chat is the interface,
// and an agent nobody has addressed has nothing to run.
//
// ONLY a greeting that really landed flips the row to `active` — it is alive and listening,
// which is exactly what the room was just told. A greeting that could not be POSTED leaves
// the row `summoned`, so the next reconcile pass retries it; the post is idempotent per
// (channel, agent, row stamp), so that retry can never produce a second arrival message.
async function greetSummoned(entry, row, myId) {
  const res = await sessionEngine.summonTeamSession(agentSpec(entry, row, myId));
  if (res && res.greeted) {
    await roster.setStatus(entry, row.id, roster.ACTIVE);
    return true;
  }
  diag('agents: summon did not greet', String(row.name || row.id).slice(0, 24), (res && res.skipped) || 'unknown');
  return false;
}

// ── A message reached this agent → open its session ──────────────────────────────
// The other half, and the ONLY caller that opens a window for a team agent besides the
// operator's own "Open session" click: a message is FOR this agent — named, or untagged
// while it is engaged — and nothing is running here, so the room-bound parked shell is
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
  const rows = await roster.fetchRoster(entry);
  if (rows === null) {
    // FIX B1: the roster is UNKNOWN, not empty. `entry.teamAgents` keeps whatever it was
    // seeded with (the durable last-known count) and `rosterKnown` stays false, so the
    // classifier fails CLOSED toward the law and the dispatcher can say so in the log.
    diag('agents: roster unknown', String(entry.channel.id).slice(0, 8), 'keeping last known', Number(entry.teamAgents) || 0);
    return false; // keep the last known roster (channel-roster.js `rosters`)
  }
  roster.setRows(entry.channel.id, rows);
  roster.noteRoster(entry, rows, myId);
  const targets = roster.summonTargets(rows, myId);
  if (!targets.length) return true;
  diag('agents: summoning', targets.length, 'in', String(entry.channel.id).slice(0, 8));
  for (const row of targets) {
    // Serial on purpose: a greeting is one POST into the same room (it spawns nothing since
    // the read-the-room turn was cut), so four at once would arrive in an undefined order.
    await greetSummoned(entry, row, myId);
  }
  // Re-publish: greetSummoned's status flips mutate the cached rows in place, so the count
  // on the entry has to be taken AFTER the summons, not before them.
  const after = roster.rowsFor(entry.channel.id);
  roster.noteRoster(entry, after.length ? after : rows, myId);
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
//                a message, a message MY OWN AGENTS wrote outside a thread (see the self brake
//                below), an agent this operator does not own (somebody else's agent, on
//                somebody else's machine; ownership comes off the authenticated roster, never
//                off the message), or no agent addressing at all with no thread of mine and
//                nothing of mine engaged to take it.
//   'fed'        delivered into that agent's own session.
//   'dismissed'  the row is retired. It keeps its handle for attribution and starts NOTHING;
//                the operator is told passively (listener-messages -> task-notify), because
//                somebody addressed an agent that is gone.
//   'refused'    mine, but this machine could not run it now. It also starts NOTHING — a
//                pair session is not a substitute for the agent that was named — and the
//                reason is always in the diag.
// Every verdict but '' is TRUTHY, so the caller short-circuits on all three.
//
// ── THREE WAYS IN, ONE DELIVERY (2026-07-31) ─────────────────────────────────────
// ADDRESSED — a message NAMES agents. `metadata.to_agent_ids` is the list and
//   `metadata.to_agent_id` is the compat mirror of its first element, so a multi-address
//   reaches EVERY one of my agents it names rather than only the one the scalar happens to
//   carry (engagement.addressedAgentIds). Each named agent is delivered to independently;
//   the verdicts are folded by `strongest`.
// IN A THREAD — a message names nobody but carries a first-class thread id, and one of my
//   agents is a PARTICIPANT of that thread (channel-threads.js). THE LAW: "Inside a thread
//   everyone in it hears everything: no tagging between participants." See routeThread.
// ENGAGED — a message names NOBODY. Today that is the end of it: classify's implicit trigger
//   is disabled while I have agents in the room, so an untagged line reaches no agent at all
//   and the operator has to re-@ on every turn. An ENGAGED agent (channel-engagement.js)
//   takes those too, for a bounded window after a human addressed it. Strictly additive: an
//   unengaged channel takes the '' path below and behaves byte for byte as before, and the
//   implicit 2-member trigger is not resurrected for anybody — this route feeds an agent
//   that already exists, it does not hand a verdict back to classify.
//
// ── MY OWN MESSAGE IS THE MAIN PATH, NOT AN EXCLUSION (2026-07-31) ────────────────
// This used to refuse `m.authorUserId === myUserId` outright, which made the PRODUCT'S PRIMARY
// FLOW impossible: an operator summons their own agent with `/new-agent` and then types
// "@quartz do X" — a message THEY authored, addressed to an agent THEY own, whose session runs
// on THIS machine — and it reached nobody. The composer's chat+`toAgents` shape is documented
// server-side as "the PRIMARY way an agent is given work" (schema.ts MessageIntentSchema), and
// the owner bridge stamps `to_user_id = me` for it, so every conjunct pointed here and the
// route dropped it on the floor. The exclusion was a fossil of the two-party ASSIST model,
// where the only trigger was a PEER asking and "a message I wrote is not a request to me" was
// therefore true.
//
// WHAT REPLACES IT IS THE LOOP BRAKE, ON THE SELF SIDE: a message this operator's account
// authored routes only when a PERSON wrote it. That is `myOwnAgentSpoke` below, which states
// why identity alone cannot tell my typing from my agent's output.
//
// WHERE THE THREAD LANE SITS IN THAT BRAKE. `myOwnAgentSpoke` is the brake, and it is applied
// to the ADDRESSED and ENGAGED lanes and NOT to the thread lane. That asymmetry is the whole
// design: in the main room there is no fence, so one of my agents naming another would run
// forever with nothing between them; inside a thread the fence is the participant set — a
// bounded, human-curated, server-side list that no agent can add itself to — and two of my
// own agents collaborating in a breakout room is the feature, not the failure. routeThread
// states the three bounds that replace the brake there.
async function routeAddressedAgent(entry, m, myUserId) {
  if (!settings.getWindowMode()) return '';
  if (!m || m.kind !== 'message') return '';
  if (!myUserId) return '';
  const ids = engagement.addressedAgentIds(m);
  if (ids.length) {
    if (myOwnAgentSpoke(m, myUserId)) return '';
    let verdict = '';
    for (const id of ids) verdict = strongest(verdict, await routeOneAddressed(entry, m, myUserId, id));
    return verdict;
  }
  const inThread = await routeThread(entry, m, myUserId);
  if (inThread) return inThread;
  if (myOwnAgentSpoke(m, myUserId)) return '';
  return routeEngaged(entry, m, myUserId);
}

// PURE: did one of MY OWN agents write this? My agent's posts are authored by my account (the
// server records author_user_id = the owner and author_kind = 'agent'), so identity alone
// cannot tell my typing from my agent's output — `humanAuthored` keys on author_kind, which
// can. Self-authored traffic is also the traffic the inbound gate deliberately does not hold
// (there is nobody to approve my own words to), so without this nothing else would stop it.
function myOwnAgentSpoke(m, myUserId) {
  return m.authorUserId === myUserId && !engagement.humanAuthored(m);
}

// ── THE THREAD LANE: a breakout room where nobody has to be tagged ────────────────
//
// A message with NO agent addressing, carrying a FIRST-CLASS thread id, delivered to every one
// of my agents that the thread's participant set names. This is the lane that makes THE LAW's
// "no tagging between participants" true on this machine, and it is the only lane that carries
// an AGENT-authored, unaddressed post — which is exactly the shape the main-room loop brake
// exists to refuse, so the three things standing in for that brake are named here:
//
//   THE PARTICIPANT SET. Bounded and human-curated. Only the thread's creator, its target, or
//     an existing HUMAN participant may add anybody (service-participants: there is no
//     self-join, and owning an agent confers no curation), and the set is read over an
//     authenticated call, never off the message. An agent cannot talk its way into a room.
//   THE SELF-ECHO FILTER. A message is never delivered back into the agent that wrote it
//     (`metadata.author_agent_id`, server-stamped from an ownership-checked field). Without
//     this a single agent in a thread would answer itself, which is a one-agent infinite loop
//     and needs no second party at all.
//   THE INBOUND GATE. Every delivery goes through session-gate, and a team session starts at
//     manual/ask (session-reducer's defaults; startSession refuses to carry a posture into a
//     parked shell). So by default each hop of an agent-to-agent exchange raises a card the
//     operator has to Accept, and the exchange advances at human speed.
// HONEST BOUND, STATED PLAINLY: if the operator sets both sessions' MESSAGE axis to auto, no
// human is in the loop any more and two agents in a thread will ping-pong until a per-session
// bound stops them — the turn cap, the cost cap, or the idle timeout (session-reducer's
// nextIdleMs / turn + cost caps, from settings). Those caps are real and they are per session,
// so the exchange is finite; nothing here makes it SHORT. That is the same trade the auto
// posture makes everywhere else in this app, and it is a deliberate operator choice.
//
// FIRST-CLASS IDS ONLY (targeting.firstClassTaskId is UUID-gated). A legacy
// `task-<channel>-<seq>` id resolves to no `channel_tasks` row, so it has no participant set
// to read and is also the one id shape a peer can set freely — it must never select a lane.
//
// Answers '' for everything except a delivery that landed, so an unreadable roster, an
// unreadable thread, a cap or a refusal all leave the message exactly where it was.
async function routeThread(entry, m, myUserId) {
  const threadId = targeting.firstClassTaskId(m);
  if (!threadId) return '';
  const rows = roster.rowsFor(entry.channel.id);
  // Cheap pre-filter: with no live agent of mine in this channel there is nobody a
  // participant row could name, so the HTTP read is skipped entirely (F-072 — the read sits
  // on the message path and most channels will never take it).
  if (!rows.some((row) => roster.isMyLiveAgent(row, myUserId))) return '';
  const participants = await threads.participantsFor(entry, threadId);
  if (!participants) return ''; // unknown participation routes nobody
  const authorAgentId = targeting.metaStr(m, 'author_agent_id');
  let verdict = '';
  for (const row of threads.myAgentParticipants(participants, rows, myUserId)) {
    if (row.id === authorAgentId) continue; // never feed an agent its own post
    if (!roster.isMyLiveAgent(row, myUserId)) continue; // a retired row is in no room
    if ((await deliverToAgent(entry, m, myUserId, row)) === 'fed') verdict = 'fed';
  }
  if (verdict) diag('agents: thread', String(threadId).slice(0, 8), 'delivered seq', m.seq);
  return verdict;
}

// Folding N deliveries into the ONE verdict the caller acts on. A delivery that landed wins:
// the message reached an agent of mine and is spoken for, whatever else was named alongside
// it. Otherwise a refusal outranks a dismissal, because both short-circuit but only the
// refusal means "mine, and this machine failed it" — the thing FIX S2 exists to keep out of
// classify. '' (nothing of mine was named) is weakest, so it survives only when every id was
// somebody else's.
const VERDICT_RANK = { '': 0, dismissed: 1, refused: 2, fed: 3 };
function strongest(a, b) {
  return (VERDICT_RANK[b] || 0) > (VERDICT_RANK[a] || 0) ? b : a;
}

// ONE named agent, resolved against the AUTHENTICATED roster. Ownership, retirement and
// liveness are decided here; the actual delivery is shared with the engaged lane below.
async function routeOneAddressed(entry, m, myUserId, toAgent) {
  const row = roster.agentById(entry.channel.id, toAgent);
  if (!row) return unroutableOwnAgent(m, myUserId, toAgent);
  if (row.ownerUserId !== myUserId) return '';
  const named = String(row.name || row.id).slice(0, 24);
  if (row.status === roster.DISMISSED) {
    diag('agents: addressed a DISMISSED row', named, 'seq', m.seq, '- nothing started');
    return 'dismissed';
  }
  if (row.status !== roster.SUMMONED && row.status !== roster.ACTIVE) {
    diag('agents: addressed row not live', named, String(row.status || '?'), '- nothing started');
    return 'refused';
  }
  return deliverToAgent(entry, m, myUserId, row);
}

// ── THE ENGAGED LANE: an UNTAGGED human message, taken by an agent already in play ─
//
// It answers '' for everything except a delivery that landed, and that asymmetry is the
// point. An addressed message MUST short-circuit even when it fails (FIX S2: falling through
// lets the owner bridge's `to_user_id = me` become a 'trigger' and a pair ASSIST session
// stands in for the named agent). An untagged one has no such trap — classify's verdict for
// it is 'fyi' while I have agents here — so a refusal here simply falls through to the
// behaviour this operator already had, which is what "additive" has to mean.
//
// ONE CONSEQUENCE, STATED PLAINLY BECAUSE IT IS THE INTERESTING ONE. In a DIRECT channel the
// server addresses every post for you, so an untagged peer message carries `to_user_id = me`
// and classify answers 'trigger' — a consent card and a pair ASSIST session. A DELIVERY here
// claims that message first, so while one of my agents is engaged in a DM, the peer's untagged
// lines go to that agent INSTEAD of raising a consent prompt. That is deliberate and it is the
// same standing consent the addressed route has always applied (an @-addressed message feeds a
// team agent with no consent row either): the operator summoned the agent and a human engaged
// it, and re-approving each line of a live exchange is the thing engagement exists to remove.
// A refusal still falls through to the prompt, and the window really is 60 minutes and not
// forever — which is only true because the refresh in deliverToAgent is HUMAN-gated.
//
// THE AUTHOR IS PART OF THE QUESTION, not just the agent: `engagedTargets` is scoped to the
// human who engaged each row (plus that row's owner), so one person engaging my agent in a
// busy channel does not hand it everybody else's asides.
async function routeEngaged(entry, m, myUserId) {
  if (!engagement.mayEngage(m, myUserId)) return ''; // human authors, non-chat posts, only
  const rows = roster.rowsFor(entry.channel.id);
  const targets = engagement.engagedTargets(entry.channel.id, rows, myUserId, m.authorUserId);
  let verdict = '';
  for (const row of targets) {
    if (!roster.isMyLiveAgent(row, myUserId)) continue; // a retired row is engaged by nothing
    if ((await deliverToAgent(entry, m, myUserId, row)) === 'fed') verdict = 'fed';
  }
  return verdict;
}

// ── THE DELIVERY, shared by both lanes ────────────────────────────────────────────
// Wake if nothing is running, check the binding, feed. The only thing the two lanes disagree
// about is how they got here.
async function deliverToAgent(entry, m, myUserId, row) {
  const named = String(row.name || row.id).slice(0, 24);
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
    authorName: io.displayNameFor(m.authorUserId),
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
  // Re-exported from channel-roster.js so this module stays the ONE import the listener
  // needs (`handleFor` is what task-notify's copy is built from).
  handleFor: roster.handleFor,
  reconcileChannel,
  reconcileAll,
  wakeChannel,
  routeAddressedAgent,
};
