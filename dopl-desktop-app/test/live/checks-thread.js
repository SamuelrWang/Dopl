'use strict';

// LIVE CONTRACT HARNESS — BREAKOUT ROOMS AND WHAT AN AGENT CAN SEE (checks 6-8).
//
// See checks-shared.js for the §2 split note, and checks.js for the ordered list these are
// registered in.

const { decide } = require('./desktop');
const {
  FAIL, SKIP, wireOf, short, result, verdict, same, missing, base, count, describeSet,
} = require('./checks-shared');

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
  // THE TAG LINE, NOT THE TRANSCRIPT. `read` echoes the message body, and that body is
  // "@hxa live harness: single address" — so `body.includes(handle)` is true for a renderer
  // that prints NO address tag at all, which is the bug this check exists to catch. The
  // assertions below are on the `· to agents` tag for THIS message's line and nowhere else.
  const tagLine = body
    .split('\n')
    .find((l) => l.includes('· to agents ') && l.includes(ctx.agents.a.id)) || '';
  const lines = [
    `read: ${body.split('\n').length} lines; agent-address tag ${body.includes('· to agents ') ? 'PRESENT' : 'ABSENT'}; ` +
      `the tag naming ${short(ctx.agents.a.id)} ${tagLine ? 'FOUND' : 'NOT FOUND'}; ` +
      `handle "${ctx.agents.a.name}" ${tagLine.includes(ctx.agents.a.name) ? 'in the tag' : 'NOT in the tag'} ` +
      `(it also appears in the echoed body text, which is why the tag is what is asserted)`,
    tagLine ? `tag as rendered: ${tagLine.slice(Math.max(0, tagLine.indexOf('· to agents ')), 160)}` : '',
    `await(since=${m.seq - 1}, timeout_ms=0): ${sawIt ? 'RETURNED the addressed message' : 'returned NOTHING'} — ` +
      (sawIt
        ? 'visible to an agent re-arming await'
        : "opAwait passes excludeAuthor=<caller>, and every message in a single-operator room is that operator's own account (the agent runs on the operator's device token). An agent re-arming await here sees NOTHING; delivery depends entirely on the desktop's feedInbound."),
  ];
  if (!body.includes('· to agents ')) return { ...missing(ctx, 'mcp_agent_address_render'), extraLines: lines.filter(Boolean) };

  const fails = [];
  if (!tagLine) {
    fails.push(
      `read prints a "· to agents" tag somewhere but none of them names ${short(ctx.agents.a.id)} — ` +
        `the message an agent must act on carries no readable address`
    );
  } else if (!tagLine.includes(ctx.agents.a.name)) {
    // A bare id is `agentRef`'s documented fail-soft when the roster join misses. It is
    // still a degradation an agent pays for: it cannot match the tag to the handle it was
    // called by, so the tag is the one place the pair has to appear.
    fails.push(`the address tag names ${short(ctx.agents.a.id)} but NOT the handle ${ctx.agents.a.name} — the roster join failed soft`);
  }
  return verdict(fails, { extraLines: lines.filter(Boolean) });
}

module.exports = { checkThreadDelivery, checkHandshake, checkAgentVisibility };
