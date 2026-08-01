'use strict';

// LIVE CONTRACT HARNESS — THE EIGHT CONTRACTS.
//
// Every one of these is a bug that SHIPPED, and every one was invisible to a green suite,
// because each layer's tests encode that layer's own assumptions. The shape they share is
// WHAT THE SERVER ACTUALLY SENDS vs WHAT THE DESKTOP ACTUALLY READS, so each check asserts
// on BOTH halves of one real message: the metadata the live API returned, and the verdict
// the shipped desktop modules reach when handed that exact object.
//
// Each is evaluated TWICE — once as the sender's machine, once as the peer's — because
// "routes to the owner only" and "routes to nobody" are different claims and a one-sided
// evaluation cannot tell them apart.
//
// ── THE THREE VERDICTS, AND WHY SKIP IS NOT A DODGE ────────────────────────────────
//   PASS  the server sent the field and the desktop read it correctly.
//   FAIL  the server sent the field and the desktop read it WRONG. This is the whole
//         point of the lane, and it is the only thing that turns the exit code red.
//   SKIP  THE TARGET SERVER DOES NOT IMPLEMENT THIS PART OF THE CONTRACT YET. The reason
//         names the exact missing field, and the run's CAPABILITY block lists every gap up
//         top. Failing here would be noise: "prod is older than this working tree" is a
//         deploy fact, not a desktop bug, and a harness that cries wolf about it stops
//         being read. The capabilities are PROBED off the live wire every run, so the day
//         the wave deploys these checks arm themselves with no edit here.

const { decide, bothMachines } = require('./desktop');

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

/** Every server capability a check can depend on, and the sentence that explains its absence. */
const CAP_WHY = {
  to_agent_ids:
    'the server does not accept `toAgents` / does not stamp `metadata.to_agent_ids` (multi-address not deployed)',
  intent:
    'the server does not accept `intent` / does not stamp `metadata.intent` (chat-vs-request not deployed)',
  engagement:
    'the agent roster DTO carries no `engagedAt` / `engagedBy` (agent engagement not deployed)',
  thread_participants: 'the thread read returns no `participants` array (breakout rooms not deployed)',
  handshake_derivation:
    'a `thread-open-<channelId>-<seq>` key seeded NO participants (server-side handshake derivation not deployed)',
  mcp_agent_address_render:
    'the deployed MCP renderer prints no `· to agents` tag (pre-BLOCKER-3 read/await render)',
};

/** The wire half of a line: what the server actually stamped. */
function wireOf(m) {
  if (!m) return 'no message';
  const meta = (m && m.metadata) || {};
  const ids = Array.isArray(meta.to_agent_ids) ? meta.to_agent_ids : null;
  return [
    `seq=${m.seq}`,
    `authorKind=${m.authorKind}`,
    `author=${short(m.authorUserId)}`,
    `intent=${meta.intent === undefined ? '-' : String(meta.intent)}`,
    `to_user_id=${short(meta.to_user_id)}`,
    `to_agent_id=${short(meta.to_agent_id)}`,
    `to_agent_ids=${ids ? `[${ids.map(short).join(',')}]` : '-'}`,
    `author_agent_id=${short(meta.author_agent_id)}`,
    `taskId=${short(meta.taskId)}`,
  ].join(' ');
}

/** The desktop half: what the shipped modules concluded. */
function readOf(d, names) {
  return [
    `routed=${d.routed === '' ? "''" : d.routed}`,
    `classify=${d.classify === null ? '(not reached)' : d.classify}`,
    `fed=[${d.fed.map((id) => names(id)).join(',')}]`,
    `woke=[${d.woke.map((id) => names(id)).join(',')}]`,
    `addressed=[${d.addressed.map((id) => names(id)).join(',')}]`,
    `isChat=${d.isChat}`,
    `mayEngage=${d.mayEngage}`,
    `teamAgents=${d.teamAgents}`,
  ].join(' ');
}

const short = (v) => (typeof v === 'string' && v ? v.slice(0, 8) : '-');
const result = (status, reason, extra) => ({ status, reason: reason || '', ...(extra || {}) });
const verdict = (fails, extra) => (fails.length ? result(FAIL, fails.join('; '), extra) : result(PASS, '', extra));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sorted = (a) => [...a].sort();

/** SKIP with the exact missing field named. */
function missing(ctx, cap) {
  return result(SKIP, `${CAP_WHY[cap]} — on ${ctx.api.baseUrl}`);
}

// ── the checks ────────────────────────────────────────────────────────────────────

/**
 * 1. `intent:"chat"` with no mentions decides NOTHING, on both machines.
 *
 * THE BUG: the server stamped `metadata.intent` and nothing on the desktop ever read it,
 * so a human aside was an inbound turn for every engaged agent in the room.
 *
 * TWO PRECONDITIONS, and both are server-side: the post must carry `intent`, and an agent
 * must actually BE engaged — otherwise the engaged lane is unreachable and the check would
 * pass against an empty room while proving nothing. The unaddressed post is still evaluated
 * either way, and what it did is reported.
 */
async function checkChatNoMentions(ctx) {
  const m = ctx.msg.chat;
  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const observed = [
    `unaddressed human post -> owner ${readOf(both.mine, ctx.name)}`,
    `unaddressed human post -> peer  ${readOf(both.peer, ctx.name)}`,
  ];
  if (!ctx.caps.intent) return { ...missing(ctx, 'intent'), extraLines: observed };
  if (!ctx.caps.engagement) return { ...missing(ctx, 'engagement'), extraLines: observed };

  const fails = [];
  if (m.metadata.intent !== 'chat') fails.push(`server did not stamp intent=chat (got ${JSON.stringify(m.metadata.intent)})`);
  if (!ctx.engagedRows.length) fails.push('no agent was engaged, so the engaged lane the chat brake guards was never reachable');
  for (const [who, d] of Object.entries(both)) {
    if (d.routed !== '') fails.push(`${who}: routed ${d.routed}, expected ''`);
    if (d.fed.length) fails.push(`${who}: fed ${d.fed.length} agent(s), expected none`);
    if (d.classify === 'trigger') fails.push(`${who}: classify said trigger`);
    if (!d.isChat) fails.push(`${who}: engagement.isChat read false off a chat post`);
  }
  return verdict(fails, { wire: wireOf(m), both });
}

/**
 * 2. A message that NAMES an agent routes to exactly that agent, on the owner's machine only.
 *
 * THE BUG: the composer inserted `@handle` as plain text and never produced `toAgents`, so a
 * message that LOOKED addressed carried no address at all. The assertion is on the STAMPED
 * metadata, which is the only place the address is real — the body text is decoration.
 */
async function checkMentionRoutesToOwnerOnly(ctx) {
  const m = ctx.msg.one;
  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const fails = [];
  if (!both.mine.addressed.length) {
    fails.push('the server stamped NO agent address for a post whose body carries an @handle');
  } else if (!same(both.mine.addressed, [ctx.agents.a.id])) {
    fails.push(`desktop read address [${both.mine.addressed.map(ctx.name).join(',')}], expected [${ctx.agents.a.name}]`);
  }
  if (both.mine.routed !== 'fed') fails.push(`owner: routed ${both.mine.routed || "''"}, expected fed`);
  if (!same(both.mine.fed, [ctx.agents.a.id])) {
    fails.push(`owner: fed [${both.mine.fed.map(ctx.name).join(',')}], expected [${ctx.agents.a.name}]`);
  }
  if (both.peer.routed !== '') fails.push(`peer: routed ${both.peer.routed}, expected '' (not the peer's agent)`);
  if (both.peer.fed.length) fails.push(`peer: fed ${both.peer.fed.length} agent(s) it does not own`);
  if (both.peer.classify === 'trigger') fails.push("peer: classify said trigger for a message naming somebody else's agent");
  const via = m.metadata.to_agent_ids ? 'to_agent_ids[] (new contract)' : 'to_agent_id scalar (compat mirror only)';
  return verdict(fails, { wire: wireOf(m), both, extraLines: [`addressing arrived as ${via}`] });
}

/**
 * 3. A message addressed to TWO agents reaches BOTH — and what the compat scalar alone
 *    would do on an older build.
 *
 * THE BUG: the server sends `to_agent_ids[]` while the installed desktop read only the
 * `to_agent_id` scalar, so the second addressee was silently dropped. The "older build" is
 * simulated HONESTLY — the same real message with the array key removed, run through the
 * same real modules — so it measures the loss instead of asserting a belief about it.
 */
async function checkMultiAddress(ctx) {
  const m = ctx.msg.two;
  const compat = [];
  // The COMPAT DIRECTION is testable on any server: a single-address post arrives as the
  // scalar alone here, and the desktop must still resolve it. That half runs regardless.
  const single = await decide(ctx.dsk, { ...base(ctx, ctx.msg.one), myUserId: ctx.me });
  compat.push(
    `compat direction (scalar-only wire -> new desktop): addressed=[${single.addressed.map(ctx.name).join(',')}] fed=[${single.fed.map(ctx.name).join(',')}]`
  );
  if (!ctx.caps.to_agent_ids) return { ...missing(ctx, 'to_agent_ids'), extraLines: compat };

  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const legacyMsg = JSON.parse(JSON.stringify(m));
  delete legacyMsg.metadata.to_agent_ids;
  const legacy = await decide(ctx.dsk, { ...base(ctx, legacyMsg), myUserId: ctx.me });

  const want = sorted([ctx.agents.a.id, ctx.agents.b.id]);
  const fails = [];
  if (!same(sorted(m.metadata.to_agent_ids), want)) {
    fails.push(`server addressing wrong: to_agent_ids=${JSON.stringify(m.metadata.to_agent_ids)}`);
  }
  if (typeof m.metadata.to_agent_id !== 'string') {
    fails.push('server dropped the compat scalar to_agent_id — an older desktop would see NO address at all');
  }
  if (!same(sorted(both.mine.fed), want)) {
    fails.push(`owner: fed [${both.mine.fed.map(ctx.name).join(',')}], expected BOTH [${want.map(ctx.name).join(',')}]`);
  }
  if (both.peer.fed.length) fails.push(`peer: fed ${both.peer.fed.length} agent(s) it does not own`);

  const lost = want.filter((id) => !legacy.fed.includes(id));
  compat.push(
    `scalar-only replay (older desktop, same real message): fed [${legacy.fed.map(ctx.name).join(',')}] — loses [${lost.map(ctx.name).join(',') || 'nothing'}]`
  );
  return verdict(fails, { wire: wireOf(m), both, extraLines: compat });
}

/**
 * 4. The operator's OWN message addressed to their OWN agent routes.
 *
 * THE BUG, and the product's primary flow: the operator's own messages were excluded from
 * every path that could reach their own agent, so "/new-agent" then "@quartz do X" reached
 * nobody. The second assertion is the gate bypass — a person's own typed sentence must feed
 * straight through rather than raising a card asking them to approve themselves.
 */
async function checkOwnMessageToOwnAgent(ctx) {
  const m = ctx.msg.one;
  const mine = await decide(ctx.dsk, { ...base(ctx, m), myUserId: ctx.me });
  const fails = [];
  if (m.authorUserId !== ctx.me) fails.push("precondition lost: this message is not the operator's own");
  if (m.authorKind !== 'user') fails.push(`precondition lost: the server stored authorKind=${m.authorKind}, so this is not a TYPED message`);
  if (mine.routed !== 'fed') fails.push(`routed ${mine.routed || "''"}, expected fed — the operator's own message reached nobody`);
  if (!mine.woke.includes(ctx.agents.a.id)) fails.push('the named agent was never woken');
  if (!mine.selfAuthoredFeeds.includes(ctx.agents.a.id)) {
    fails.push('fed WITHOUT selfAuthored — the operator would be asked to approve their own sentence');
  }
  return verdict(fails, { wire: wireOf(m), both: { mine } });
}

/**
 * 5. An AGENT-authored, unaddressed message engages nobody and triggers nobody, on both
 *    machines. THE LOOP BRAKE, against real wire data.
 */
async function checkAgentAuthoredUnaddressed(ctx) {
  const m = ctx.msg.agentNoise;
  const both = await bothMachines(ctx.dsk, base(ctx, m));
  const fails = [];
  if (m.authorKind !== 'agent') fails.push(`server stored authorKind=${m.authorKind}, expected agent`);
  if (typeof m.metadata.author_agent_id !== 'string') fails.push('server did not stamp author_agent_id');
  if (m.metadata.to_agent_ids || m.metadata.to_agent_id) fails.push('server addressed an unaddressed post');
  for (const [who, d] of Object.entries(both)) {
    if (d.routed !== '') fails.push(`${who}: routed ${d.routed}`);
    if (d.fed.length) fails.push(`${who}: fed ${d.fed.length} agent(s) off an agent-authored post`);
    if (d.classify === 'trigger') fails.push(`${who}: classify said trigger for an agent-authored unaddressed post`);
    if (d.humanAuthored) fails.push(`${who}: engagement.humanAuthored read TRUE off an agent post`);
  }
  return verdict(fails, { wire: wireOf(m), both });
}

/**
 * 6. A thread-tagged post from ONE agent reaches the OTHER agent that participates in that
 *    thread — with no addressing anywhere on the message.
 *
 * THE BUG: a thread-tagged post never reached a team session because the session key has an
 * `agentId` axis the lookup did not. The participant set here is the LIVE one, read back off
 * `GET /tasks/{id}`, so the delivery decision is made against server truth rather than a
 * fixture that agrees with the code.
 */
async function checkThreadDelivery(ctx) {
  if (!ctx.caps.thread_participants) return missing(ctx, 'thread_participants');
  if (!ctx.room) return result(SKIP, ctx.roomSkip || 'no breakout thread was opened');
  const m = ctx.msg.threadPost;
  if (!m) return result(FAIL, `the participating agent could not post into the thread: ${ctx.threadPostError || 'unknown'}`);
  const opts = { ...base(ctx, m), participants: ctx.roomParticipants };
  const both = {
    mine: await decide(ctx.dsk, { ...opts, myUserId: ctx.me }),
    peer: await decide(ctx.dsk, { ...opts, myUserId: ctx.peer }),
  };
  const fails = [];
  if (m.metadata.taskId !== ctx.room.id) {
    fails.push(`server stored taskId=${short(m.metadata.taskId)}, expected ${short(ctx.room.id)} — the post was silently un-threaded`);
  }
  if (m.metadata.to_agent_ids || m.metadata.to_agent_id) {
    fails.push('precondition lost: this post carries an agent address, so it is not testing the thread lane');
  }
  if (!same(both.mine.fed, [ctx.agents.a.id])) {
    fails.push(
      `owner: fed [${both.mine.fed.map(ctx.name).join(',')}], expected exactly [${ctx.agents.a.name}] — the OTHER participant (the author is self-echo filtered)`
    );
  }
  if (both.mine.fed.includes(ctx.agents.b.id)) fails.push('the authoring agent was fed its own post (self-echo filter failed)');
  if (both.peer.fed.length) fails.push(`peer: fed ${both.peer.fed.length} agent(s) it does not own`);
  return verdict(fails, { wire: wireOf(m), both, extraLines: [`participant set (live): ${describeSet(ctx.roomParticipants)}`] });
}

/**
 * 7. THE HANDSHAKE. `client_msg_id="thread-open-<channelUUID>-<seq>"` seeds the thread's
 *    participants from the triggering message's `to_agent_ids`, and the NON-OPENING agent
 *    can then post into it.
 *
 * The SLUG form of the same key is run too, and whatever it does is PINNED — that ambiguity
 * is an open blocker, and a harness that only tested the shape we hope for would leave it
 * open. Both key forms are reported on every run, deployed or not.
 */
async function checkHandshake(ctx) {
  const lines = [
    `uuid-form key "thread-open-<channelId>-${ctx.handshakeSeq}" seeded ${count(ctx.derivedParticipants)}: ${describeSet(ctx.derivedParticipants)}`,
    `slug-form key "thread-open-<slug>-${ctx.handshakeSeq}"      seeded ${count(ctx.slugParticipants)}: ${describeSet(ctx.slugParticipants)}`,
  ];
  if (ctx.room) {
    lines.push(
      ctx.msg.threadPost
        ? `a NON-OPENING participating agent CAN post into a seeded thread (HTTP 201, taskId stamped) — verified live`
        : `a NON-OPENING participating agent COULD NOT post into the thread: ${ctx.threadPostError}`
    );
  }
  if (!ctx.caps.to_agent_ids) return { ...missing(ctx, 'to_agent_ids'), extraLines: lines };
  if (!ctx.caps.handshake_derivation) return { ...missing(ctx, 'handshake_derivation'), extraLines: lines };

  const fails = [];
  const set = ctx.derivedParticipants || [];
  const agentIds = set.filter((p) => p.kind === 'agent').map((p) => p.agentId);
  const users = set.filter((p) => p.kind === 'user').map((p) => p.userId);
  if (!agentIds.includes(ctx.agents.a.id)) fails.push(`derived set missing agent ${ctx.agents.a.name}`);
  if (!agentIds.includes(ctx.agents.b.id)) fails.push(`derived set missing agent ${ctx.agents.b.name}`);
  if (!users.includes(ctx.me)) fails.push('derived set missing the instruction author / agent owner');
  if (!ctx.msg.threadPost) fails.push(`the non-opening agent could not post into the thread: ${ctx.threadPostError || 'unknown'}`);
  if (count(ctx.slugParticipants) === 0) {
    lines.push(
      'the slug form derives NOTHING here: the thread keeps the creator/target pair gate, so a co-addressed agent is 403d out of the room it was told to join. The MCP create_thread lane REWRITES the key (channel-handshake-key.ts); a raw API caller is not rescued.'
    );
  }
  return verdict(fails, { extraLines: lines });
}

/**
 * 8. WHAT AN AGENT CAN ACTUALLY SEE. `read` and `await` are the only two surfaces an agent
 *    has, so a message it cannot see is a message it cannot act on, whatever the desktop
 *    decided about it. Run against the REAL MCP endpoint with the REAL device token.
 */
async function checkAgentVisibility(ctx) {
  const m = ctx.msg.one;
  const read = await ctx.api.mcp('dopl_channel', { op: 'read', channel: ctx.channel.id, since: 0 });
  if (!read.ok) return result(FAIL, `MCP read failed: HTTP ${read.status} ${String(read.rendered || read.text).slice(0, 300)}`);
  const body = read.rendered;

  const awaited = await ctx.api.mcp('dopl_channel', {
    op: 'await',
    channel: ctx.channel.id,
    since: Math.max(0, m.seq - 1),
    timeout_ms: 0,
  });
  const sawIt = awaited.ok && awaited.rendered.includes(`#${m.seq}`);
  const lines = [
    `read: ${body.split('\n').length} lines; agent-address tag ${body.includes('· to agents ') ? 'PRESENT' : 'ABSENT'}; ` +
      `handle "${ctx.agents.a.name}" ${body.includes(ctx.agents.a.name) ? 'printed' : 'NOT printed'}; ` +
      `agent id ${body.includes(ctx.agents.a.id) ? 'printed' : 'NOT printed'}`,
    `await(since=${m.seq - 1}, timeout_ms=0): ${sawIt ? 'RETURNED the addressed message' : 'returned NOTHING'} — ` +
      (sawIt
        ? 'visible to an agent re-arming await'
        : "opAwait passes excludeAuthor=<caller>, and every message in a single-operator room is that operator's own account (the agent runs on the operator's device token). An agent re-arming await here sees NOTHING; delivery depends entirely on the desktop's feedInbound."),
  ];
  if (!body.includes('· to agents ')) return { ...missing(ctx, 'mcp_agent_address_render'), extraLines: lines };

  const fails = [];
  if (!body.includes(ctx.agents.a.id)) fails.push(`read never prints agent id ${short(ctx.agents.a.id)} (${ctx.agents.a.name})`);
  if (!body.includes(ctx.agents.a.name)) fails.push(`read never prints handle ${ctx.agents.a.name}`);
  return verdict(fails, { extraLines: lines });
}

// ── helpers ───────────────────────────────────────────────────────────────────────

function base(ctx, m) {
  return {
    channel: ctx.channel,
    workspaceId: ctx.workspaceId,
    roster: ctx.roster,
    participants: undefined,
    message: m,
    myUserId: ctx.me,
    peerUserId: ctx.peer,
  };
}

const count = (set) => (Array.isArray(set) ? set.length : 'n/a');
const describeSet = (set) =>
  Array.isArray(set)
    ? set.length
      ? set.map((p) => `${p.kind}:${short(p.agentId || p.userId)}`).join(' ')
      : '(empty)'
    : '(no participants field)';

const CHECKS = [
  { id: 1, title: 'chat + no mentions decides NOTHING on both machines', run: checkChatNoMentions },
  { id: 2, title: 'an @-named agent is routed to, on the owner machine only', run: checkMentionRoutesToOwnerOnly },
  { id: 3, title: 'two addressed agents BOTH routed (and what the compat scalar loses)', run: checkMultiAddress },
  { id: 4, title: "the operator's OWN message to their OWN agent routes", run: checkOwnMessageToOwnAgent },
  { id: 5, title: 'agent-authored + unaddressed engages and triggers nobody', run: checkAgentAuthoredUnaddressed },
  { id: 6, title: 'a thread-tagged agent post reaches the OTHER participant agent', run: checkThreadDelivery },
  { id: 7, title: 'handshake seeds participants; the non-opening agent can post', run: checkHandshake },
  { id: 8, title: 'what read / await actually render for an agent-addressed message', run: checkAgentVisibility },
];

module.exports = { CHECKS, CAP_WHY, PASS, FAIL, SKIP, wireOf, readOf, short };
